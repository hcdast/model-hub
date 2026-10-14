import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { PortalAuthService } from './portal-auth.service';
import { PortalRefreshTokenSchema } from '../database/schemas/portal-refresh-token.schema';

const userId = '507f1f77bcf86cd799439011';
const password = 'PreviousPassword123';
const envKeys = ['PORTAL_JWT_SECRET', 'PORTAL_ACCESS_TOKEN_EXPIRES', 'PORTAL_REFRESH_TOKEN_EXPIRES_DAYS'] as const;
const savedEnv = envKeys.map(key => process.env[key]);
let passwordHash: string;

beforeAll(async () => {
  process.env.PORTAL_JWT_SECRET = 'portal-auth-version-test-secret-at-least-32-bytes';
  process.env.PORTAL_ACCESS_TOKEN_EXPIRES = '15m';
  process.env.PORTAL_REFRESH_TOKEN_EXPIRES_DAYS = '7';
  passwordHash = await bcrypt.hash(password, 10);
});
afterAll(() => envKeys.forEach((key, index) => {
  if (savedEnv[index] === undefined) delete process.env[key];
  else process.env[key] = savedEnv[index];
}));

/** Separate persisted state from authentication snapshots to control concurrent writes. */
function harness() {
  const state: { user: Record<string, any> | null; tokens: Record<string, any>[] } = {
    user: { _id: new Types.ObjectId(userId), email: 'portal@example.com', username: 'portal-user',
      passwordHash, authVersion: 0, role: 'user', status: 'active', deletedAt: null },
    tokens: [],
  };
  const snapshot = () => state.user && { ...state.user, save: jest.fn().mockResolvedValue(undefined) };
  const userModel = {
    findById: jest.fn(async () => snapshot()),
    findOne: jest.fn(async () => snapshot()),
    create: jest.fn(async value => { state.user = { ...value, _id: new Types.ObjectId(userId) }; return snapshot(); }),
    deleteOne: jest.fn(),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      if (!state.user || (filter.passwordHash && filter.passwordHash !== state.user.passwordHash)) return null;
      state.user = { ...state.user, ...update.$set, authVersion: (state.user.authVersion ?? 0) + update.$inc.authVersion };
      return snapshot();
    }),
  };
  const persistToken = async (value: Record<string, any>) => {
    const token: Record<string, any> = { ...value, save: jest.fn().mockResolvedValue(undefined) };
    state.tokens.push(token);
    return token;
  };
  const tokenModel = {
    collection: { indexes: jest.fn().mockResolvedValue([]), dropIndex: jest.fn().mockResolvedValue(undefined) },
    create: jest.fn(persistToken),
    findOne: jest.fn(filter => ({ select: async () => state.tokens.find(token => token.tokenId === filter.tokenId) })),
    updateOne: jest.fn(async (filter, update) => {
      const token = state.tokens.find(item => item.tokenId === filter.tokenId && item.userId === filter.userId);
      if (token) Object.assign(token, update);
    }),
    updateMany: jest.fn(async (filter, update) => {
      for (const token of state.tokens) {
        if (filter.userId && token.userId !== filter.userId) continue;
        if (filter.familyId && token.familyId !== filter.familyId) continue;
        if (filter.$or && token.authVersion !== undefined && token.authVersion >= filter.$or[1].authVersion.$lt) continue;
        Object.assign(token, update);
      }
    }),
  };
  const service = new PortalAuthService(userModel as never, tokenModel as never);
  const seedToken = async (authVersion: unknown = 0) => {
    const token = await persistToken({ userId, authVersion, tokenId: 'old-token', familyId: 'old-family',
      secretHash: createHash('sha256').update('old-secret').digest('hex'), isValid: true,
      expiresAt: new Date(Date.now() + 60000) });
    return token;
  };
  return { state, userModel, tokenModel, service, persistToken, seedToken };
}

function barrier() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const resumed = new Promise<void>(resolve => { release = resolve; });
  return { entered, enter, resumed, release };
}

describe('Portal authentication version', () => {
  it.each(['login', 'refresh', 'register'])('rejects an old %s snapshot issued after password reset', async operation => {
    const h = harness();
    if (operation === 'register') {
      h.state.user = null;
      h.userModel.findOne.mockResolvedValue(null);
    } else if (operation === 'refresh') await h.seedToken();
    const gate = barrier();
    h.tokenModel.create.mockImplementationOnce(async value => {
      gate.enter();
      await gate.resumed;
      return h.persistToken(value);
    });
    const pending = (operation === 'login' ? h.service.login('portal@example.com', password)
      : operation === 'refresh' ? h.service.refreshToken('old-token.old-secret')
      : h.service.register('portal@example.com', 'portal-user', password)).catch(error => error);
    await gate.entered;
    try {
      await h.service.resetPassword(userId);
    } finally {
      gate.release();
    }
    expect(await pending).toBeInstanceOf(UnauthorizedException);
    expect(h.state.user?.authVersion).toBe(1);
    const issued = h.state.tokens[h.state.tokens.length - 1];
    expect(issued.authVersion).toBe(0);
    expect(issued.isValid).toBe(false);
    expect(h.userModel.deleteOne).not.toHaveBeenCalled();
  });

  it('preserves new-password sessions issued while password-change cleanup is pending', async () => {
    const h = harness();
    await h.seedToken();
    const gate = barrier();
    const cleanup = h.tokenModel.updateMany.getMockImplementation()!;
    h.tokenModel.updateMany.mockImplementationOnce(async (filter, update) => {
      gate.enter(); await gate.resumed; return cleanup(filter, update);
    });
    const newPassword = 'ChangedPassword123';
    const reset = h.service.changePassword(userId, password, newPassword);
    await gate.entered;
    try {
      const login = await h.service.login('portal@example.com', newPassword);
      expect(login.user).not.toHaveProperty('authVersion');
    } finally { gate.release(); }
    await reset;
    expect(h.state.tokens.map(token => [token.authVersion, token.isValid])).toEqual([[0, false], [1, true]]);
  });

  it('denies old refresh tokens even if cleanup fails after the password commit', async () => {
    const h = harness();
    await h.seedToken();
    h.tokenModel.updateMany.mockRejectedValue(new Error('private-storage-error'));
    await expect(h.service.resetPassword(userId)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.state.user?.authVersion).toBe(1);
    expect(h.state.tokens[0].isValid).toBe(true);
    await expect(h.service.refreshToken('old-token.old-secret')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.tokenModel.create).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '0', -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects missing or invalid token version %j', async version => {
    const h = harness();
    const token = await h.seedToken();
    if (version === undefined) delete token.authVersion; else token.authVersion = version;
    await expect(h.service.refreshToken('old-token.old-secret')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.tokenModel.create).not.toHaveBeenCalled();
  });

  it('allows a legacy user without a version but requires explicit version zero on its new token', async () => {
    const h = harness();
    delete h.state.user!.authVersion;
    const login = await h.service.login('portal@example.com', password);
    expect(h.state.tokens[0].authVersion).toBe(0);
    await expect(h.service.refreshToken(login.refreshToken)).resolves.toHaveProperty('accessToken');
    expect(h.state.tokens[1].authVersion).toBe(0);
    expect(PortalRefreshTokenSchema.path('authVersion').options.default).toBeUndefined();
  });

  it('fails a password change if a concurrent reset has replaced the verified password', async () => {
    const h = harness();
    const gate = barrier();
    const write = h.userModel.findOneAndUpdate.getMockImplementation()!;
    h.userModel.findOneAndUpdate.mockImplementationOnce(async (filter, update) => {
      gate.enter(); await gate.resumed; return write(filter, update);
    });
    const change = h.service.changePassword(userId, password, 'ChangedPassword123').catch(error => error);
    await gate.entered;
    let temporaryPassword: string;
    try { temporaryPassword = await h.service.resetPassword(userId); } finally { gate.release(); }
    expect((await change).getStatus()).toBe(409);
    expect(await bcrypt.compare(temporaryPassword!, h.state.user!.passwordHash)).toBe(true);
    expect(h.state.user?.authVersion).toBe(1);
  });
});

describe('Portal legacy index migration', () => {
  it.each([26, 27])('accepts concurrent deletion ending with Mongo code %s', async code => {
    const h = harness();
    h.tokenModel.collection.indexes.mockResolvedValue([
      { name: 'token_1', key: { token: 1 }, unique: true },
      { name: 'tokenId_1', key: { tokenId: 1 }, unique: true },
    ]);
    h.tokenModel.collection.dropIndex.mockRejectedValue({ code });
    await expect(h.service.onModuleInit()).resolves.toBeUndefined();
    expect(h.tokenModel.collection.dropIndex).toHaveBeenCalledWith('token_1');
    expect(h.tokenModel.collection.dropIndex).toHaveBeenCalledTimes(1);
  });

  it('accepts a collection that has not been created on first startup', async () => {
    const h = harness();
    h.tokenModel.collection.indexes.mockRejectedValue({ code: 26 });
    await expect(h.service.onModuleInit()).resolves.toBeUndefined();
    expect(h.tokenModel.collection.dropIndex).not.toHaveBeenCalled();
  });

  it.each(['indexes', 'dropIndex'])('propagates storage failures from %s', async operation => {
    const h = harness();
    const failure = Object.assign(new Error('storage unavailable'), { code: 13 });
    h.tokenModel.collection.indexes.mockResolvedValue([{ name: 'token_1', key: { token: 1 }, unique: true }]);
    h.tokenModel.collection[operation as 'indexes' | 'dropIndex'].mockRejectedValue(failure);
    await expect(h.service.onModuleInit()).rejects.toBe(failure);
  });
});

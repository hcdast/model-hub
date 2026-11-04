import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { PortalAuthService } from './portal-auth.service';
import { AppConfig } from '../config/interfaces/config.interface';

describe('Portal OAuth account and password recovery', () => {
  const config = { portalAuth: { jwtSecret: 'social-auth-test-secret-at-least-32-bytes' } } as AppConfig;
  const userId = new Types.ObjectId();
  let user: any;
  let users: any;
  let tokens: any;
  let service: PortalAuthService;
  const profile = { id: 'provider-user', email: 'person@example.com', username: 'Person' };
  beforeEach(() => {
    user = { _id: userId, email: profile.email, username: 'Person', role: 'user', status: 'active', authVersion: 0, save: jest.fn() };
    users = { findOne: jest.fn(), findById: jest.fn(async () => user), create: jest.fn(async value => Object.assign(user, value)),
      findOneAndUpdate: jest.fn(async (_filter, update) => { Object.assign(user, update.$set); user.authVersion++; return user; }) };
    tokens = { create: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn() };
    service = new PortalAuthService(users, tokens, config);
  });

  it('creates a verified ordinary OAuth user without a password and issues normal refresh sessions', async () => {
    users.findOne.mockResolvedValue(null);
    const result = await service.loginWithOAuth('google', profile, '127.0.0.1', 'test-browser');
    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ googleId: profile.id, emailVerifiedAt: expect.any(Date), role: 'user', status: 'active' }));
    expect(user.passwordHash).toBeUndefined();
    expect(result.user).toMatchObject({ authMethods: { password: false, google: true, github: false } });
    expect(result.user).not.toHaveProperty('googleId');
    expect(tokens.create).toHaveBeenCalledWith(expect.objectContaining({ authVersion: 0, userAgent: 'test-browser', ip: '127.0.0.1' }));
    expect(service.verifyAccessToken(result.accessToken).sub).toBe(userId.toString());
  });

  it('identifies a returning account by provider subject even if the provider email has changed', async () => {
    user.githubId = profile.id;
    users.findOne.mockResolvedValue(user);
    const result = await service.loginWithOAuth('github', { ...profile, email: 'changed@example.com' });
    expect(users.findOne).toHaveBeenCalledWith({ githubId: profile.id });
    expect(users.create).not.toHaveBeenCalled();
    expect(result.user.email).toBe(profile.email);
  });

  it('never auto-links an existing email account, including soft-deleted records', async () => {
    users.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...user, deletedAt: new Date() });
    await expect(service.loginWithOAuth('google', profile)).rejects.toBeInstanceOf(ConflictException);
    expect(users.create).not.toHaveBeenCalled();
    expect(tokens.create).not.toHaveBeenCalled();
  });

  describe('explicit OAuth linking', () => {
    const account = { userId: userId.toString(), authVersion: 0 };
    beforeEach(() => {
      users.findOne.mockResolvedValue(user);
      users.findOneAndUpdate.mockImplementation(async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
        Object.assign(user, update.$set);
        return user;
      });
    });

    it('links the authenticated existing account and preserves its password, role and data', async () => {
      user.passwordHash = 'existing-password-hash';
      user.role = 'vip';
      user.usage = { totalWorkflows: 12 };
      const result = await service.linkOAuthAccount('google', profile, account);
      expect(result.user.id).toBe(userId.toString());
      expect(result.user.authMethods).toMatchObject({ password: true, google: true });
      expect(user).toMatchObject({ passwordHash: 'existing-password-hash', role: 'vip', authVersion: 0, usage: { totalWorkflows: 12 } });
      expect(users.create).not.toHaveBeenCalled();
      expect(users.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({
        _id: userId, email: profile.email, status: 'active', deletedAt: null,
        googleId: { $in: [null, profile.id] },
        $or: [{ authVersion: 0 }, { authVersion: { $exists: false } }],
      }), { $set: { googleId: profile.id } }, { new: true });
      expect(service.verifyAccessToken(result.accessToken).sub).toBe(account.userId);
    });

    it.each(['changed-version', 'suspended', 'deleted', 'missing'])('rejects a %s local account before linking', async state => {
      if (state === 'changed-version') user.authVersion = 1;
      if (state === 'suspended') user.status = 'suspended';
      if (state === 'deleted') user.deletedAt = new Date();
      if (state === 'missing') users.findById.mockResolvedValue(null);
      await expect(service.linkOAuthAccount('google', profile, account)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.findOneAndUpdate).not.toHaveBeenCalled();
      expect(tokens.create).not.toHaveBeenCalled();
    });

    it('rejects a different email and refuses to replace an existing provider identity', async () => {
      await expect(service.linkOAuthAccount('google', { ...profile, email: 'other@example.com' }, account)).rejects.toBeInstanceOf(ConflictException);
      user.googleId = 'another-google-user';
      await expect(service.linkOAuthAccount('google', profile, account)).rejects.toBeInstanceOf(ConflictException);
      expect(users.findOneAndUpdate).not.toHaveBeenCalled();
      expect(tokens.create).not.toHaveBeenCalled();
    });

    it('rejects a provider identity already owned elsewhere without issuing sessions', async () => {
      users.findOneAndUpdate.mockRejectedValue({ code: 11000 });
      await expect(service.linkOAuthAccount('google', profile, account)).rejects.toBeInstanceOf(ConflictException);
      expect(tokens.create).not.toHaveBeenCalled();
    });

    it('rejects an account changed during the atomic update', async () => {
      users.findOneAndUpdate.mockResolvedValue(null);
      await expect(service.linkOAuthAccount('google', profile, account)).rejects.toBeInstanceOf(ConflictException);
      expect(tokens.create).not.toHaveBeenCalled();
    });

    it('does not issue tokens if credentials change after linking', async () => {
      users.findOneAndUpdate.mockImplementation(async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
        Object.assign(user, update.$set);
        user.authVersion = 1;
        return user;
      });
      await expect(service.linkOAuthAccount('google', profile, account)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tokens.create).not.toHaveBeenCalled();
    });

    it('does not sign in a different account after linking', async () => {
      users.findOne.mockResolvedValue({ ...user, _id: new Types.ObjectId() });
      await expect(service.linkOAuthAccount('google', profile, account)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tokens.create).not.toHaveBeenCalled();
    });
  });

  it.each(['suspended', 'pending', 'deleted'])('does not issue sessions for %s OAuth accounts', async state => {
    if (state === 'deleted') user.deletedAt = new Date(); else user.status = state;
    users.findOne.mockResolvedValue(user);
    await expect(service.loginWithOAuth('google', profile)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens.create).not.toHaveBeenCalled();
  });

  it('recovers a concurrent first-login duplicate only when the provider identity matches', async () => {
    users.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(user);
    users.create.mockRejectedValue({ code: 11000 });
    await expect(service.loginWithOAuth('github', profile)).resolves.toHaveProperty('refreshToken');
    expect(users.findOne).toHaveBeenLastCalledWith({ githubId: profile.id });
  });

  it('refuses email-password login and recovery for OAuth-only accounts', async () => {
    users.findOne.mockResolvedValue(user);
    await expect(service.login(profile.email, 'password123')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.canResetPassword(profile.email)).resolves.toBe(false);
    await expect(service.recoverPassword(profile.email, 'new-password')).rejects.toThrow('Unable to reset');
    expect(users.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('updates the password with a concurrency guard, advances auth version and revokes older refresh tokens', async () => {
    user.passwordHash = await bcrypt.hash('previous-password', 10);
    const previousHash = user.passwordHash;
    users.findOne.mockResolvedValue(user);
    await service.recoverPassword('PERSON@example.com', 'new-password');
    expect(users.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ _id: userId, passwordHash: previousHash });
    expect(await bcrypt.compare('new-password', user.passwordHash)).toBe(true);
    expect(user.authVersion).toBe(1);
    expect(tokens.updateMany.mock.calls[0][0]).toMatchObject({ userId: userId.toString(), $or: [{ authVersion: { $exists: false } }, { authVersion: { $lt: 1 } }] });
  });

  it('rejects bcrypt-truncated multibyte passwords before storing an account', async () => {
    await expect(service.register(profile.email, profile.username, '密'.repeat(25))).rejects.toThrow('72 UTF-8 bytes');
    expect(users.create).not.toHaveBeenCalled();
  });
});

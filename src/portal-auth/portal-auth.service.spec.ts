import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { PortalAuthService } from './portal-auth.service';
import { PortalUser } from '../database/schemas/portal-user.schema';
import { PortalRefreshToken } from '../database/schemas/portal-refresh-token.schema';

describe('PortalAuthService resetPassword', () => {
  const userId = '507f1f77bcf86cd799439011';
  const oldPassword = 'PreviousPassword123';
  const userModel = { findById: jest.fn(), findOneAndUpdate: jest.fn() };
  const refreshTokenModel = { updateMany: jest.fn() };
  const save = jest.fn();
  const envKeys = ['PORTAL_JWT_SECRET', 'PORTAL_ACCESS_TOKEN_EXPIRES', 'PORTAL_REFRESH_TOKEN_EXPIRES_DAYS'] as const;
  const previousEnv = envKeys.map((key) => process.env[key]);
  let service: PortalAuthService;
  let user: { _id: Types.ObjectId; passwordHash: string; authVersion?: number; deletedAt: Date | null; save: typeof save };

  beforeAll(async () => {
    process.env.PORTAL_JWT_SECRET = 'portal-password-reset-test-secret-32-bytes';
    process.env.PORTAL_ACCESS_TOKEN_EXPIRES = '15m';
    process.env.PORTAL_REFRESH_TOKEN_EXPIRES_DAYS = '7';
    const module = await Test.createTestingModule({
      providers: [
        PortalAuthService,
        { provide: getModelToken(PortalUser.name), useValue: userModel },
        { provide: getModelToken(PortalRefreshToken.name), useValue: refreshTokenModel },
      ],
    }).compile();
    service = module.get(PortalAuthService);
  });

  afterAll(() => {
    envKeys.forEach((key, index) => {
      if (previousEnv[index] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[index];
    });
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    user = { _id: new Types.ObjectId(userId), passwordHash: await bcrypt.hash(oldPassword, 10), deletedAt: null, save };
    userModel.findById.mockResolvedValue(user);
    userModel.findOneAndUpdate.mockImplementation(async (_filter, update) => {
      user = { ...user, ...update.$set, authVersion: (user.authVersion ?? 0) + update.$inc.authVersion };
      return user;
    });
    save.mockResolvedValue(undefined);
    refreshTokenModel.updateMany.mockResolvedValue({ modifiedCount: 3 });
  });

  it('atomically stores a bcrypt hash and advances the version before revoking older refresh families', async () => {
    const previousHash = user.passwordHash;
    const temporaryPassword = await service.resetPassword(userId);

    expect(temporaryPassword.length).toBeGreaterThanOrEqual(8);
    expect(temporaryPassword).toMatch(/[a-z]/);
    expect(temporaryPassword).toMatch(/[A-Z]/);
    expect(temporaryPassword).toMatch(/[0-9]/);
    expect(user.passwordHash).not.toBe(temporaryPassword);
    expect(user.passwordHash).not.toBe(previousHash);
    expect(bcrypt.getRounds(user.passwordHash)).toBe(10);
    expect(await bcrypt.compare(temporaryPassword, user.passwordHash)).toBe(true);
    expect(await bcrypt.compare(oldPassword, user.passwordHash)).toBe(false);
    expect(user.authVersion).toBe(1);
    expect(save).not.toHaveBeenCalled();
    expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: user._id, deletedAt: null }),
      { $set: { passwordHash: user.passwordHash }, $inc: { authVersion: 1 } },
      { new: true },
    );
    expect(refreshTokenModel.updateMany).toHaveBeenCalledTimes(1);
    expect(refreshTokenModel.updateMany).toHaveBeenCalledWith(
      { userId, $or: [{ authVersion: { $exists: false } }, { authVersion: { $lt: 1 } }] },
      { isValid: false, revokedAt: expect.any(Date) },
    );
  });

  it('revokes refresh tokens using the stored canonical id when the request id is uppercase', async () => {
    await service.resetPassword(userId.toUpperCase());

    expect(userModel.findById).toHaveBeenCalledWith(userId.toUpperCase());
    expect(refreshTokenModel.updateMany).toHaveBeenCalledWith(
      { userId, $or: [{ authVersion: { $exists: false } }, { authVersion: { $lt: 1 } }] },
      { isValid: false, revokedAt: expect.any(Date) },
    );
  });

  it.each(['invalid', '507f1f77bcf86cd79943901', 'z'.repeat(24), ''])('rejects invalid id %j before accessing storage', async (id) => {
    await expect(service.resetPassword(id)).rejects.toBeInstanceOf(BadRequestException);
    expect(userModel.findById).not.toHaveBeenCalled();
    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(refreshTokenModel.updateMany).not.toHaveBeenCalled();
  });

  it('returns not found for a missing user without writing', async () => {
    userModel.findById.mockResolvedValue(null);
    await expect(service.resetPassword(userId)).rejects.toBeInstanceOf(NotFoundException);
    expect(save).not.toHaveBeenCalled();
    expect(refreshTokenModel.updateMany).not.toHaveBeenCalled();
  });

  it('returns not found for a soft-deleted user without changing the password or sessions', async () => {
    user.deletedAt = new Date();
    const previousHash = user.passwordHash;
    await expect(service.resetPassword(userId)).rejects.toBeInstanceOf(NotFoundException);
    expect(user.passwordHash).toBe(previousHash);
    expect(save).not.toHaveBeenCalled();
    expect(refreshTokenModel.updateMany).not.toHaveBeenCalled();
  });

  it('does not revoke sessions or report success when the atomic write fails', async () => {
    userModel.findOneAndUpdate.mockRejectedValue(new Error('save failed'));
    await expect(service.resetPassword(userId)).rejects.toThrow('save failed');
    expect(refreshTokenModel.updateMany).not.toHaveBeenCalled();
  });

  it('does not report success when session revocation fails', async () => {
    refreshTokenModel.updateMany.mockRejectedValue(new Error('revoke failed'));
    await expect(service.resetPassword(userId)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(user.authVersion).toBe(1);
  });

  it('does not revoke sessions when the user changes during the atomic write', async () => {
    userModel.findOneAndUpdate.mockResolvedValue(null);
    await expect(service.resetPassword(userId)).rejects.toBeInstanceOf(ConflictException);
    expect(refreshTokenModel.updateMany).not.toHaveBeenCalled();
  });
});

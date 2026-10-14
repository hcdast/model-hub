import { BadRequestException, INestApplication, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { AdminAuthService } from './admin-auth.service';
import { AdminPortalUserController } from './admin-portal-user.controller';
import { PermissionCheckService } from './permission-check.service';
import { PortalApiKey } from '../database/schemas/portal-api-key.schema';
import { PortalUser } from '../database/schemas/portal-user.schema';
import { PortalAuthService } from '../portal-auth/portal-auth.service';

describe('AdminPortalUserController authorization', () => {
  let app: INestApplication;
  let baseUrl: string;
  const userId = '507f1f77bcf86cd799439011';
  const accounts: Record<string, { sub: string; username: string; roles: string[] }> = {
    superAdmin: { sub: 'super-admin-id', username: 'super-admin', roles: ['super_admin'] },
    customRole: { sub: 'custom-role-id', username: 'operator', roles: ['portal_operator'] },
    admin: { sub: 'admin-id', username: 'admin', roles: ['admin'] },
  };
  const permissions = new Map<string, Set<string>>();
  const portalUser = {
    _id: userId,
    email: 'portal@example.com',
    username: 'portal-user',
    role: 'user',
    status: 'active',
  };
  const save = jest.fn();
  const listQuery = {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([portalUser]),
  };
  const portalUserModel = {
    find: jest.fn().mockReturnValue(listQuery),
    countDocuments: jest.fn().mockResolvedValue(1),
    aggregate: jest.fn().mockResolvedValue([{ _id: 'user', count: 1 }]),
    findById: jest.fn(),
  };
  const portalApiKeyModel = {
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const portalAuthService = {
    resetPassword: jest.fn().mockResolvedValue('TemporaryPass123'),
  };
  const authService = {
    verifyToken: jest.fn((token: string) => {
      const account = accounts[token];
      if (!account) throw new UnauthorizedException('无效令牌');
      return account;
    }),
  };
  const permissionCheckService = {
    checkAllPermissions: jest.fn(async (id: string, required: string[]) =>
      required.every((permission) => permissions.get(id)?.has(permission) === true),
    ),
    checkAnyPermission: jest.fn(async (id: string, required: string[]) =>
      required.some((permission) => permissions.get(id)?.has(permission) === true),
    ),
  };
  const readRoutes = ['', '/stats/overview'];
  const writeRoutes = [
    { method: 'PUT', path: `/${userId}`, permission: 'portal-user:update', body: { username: 'updated' } },
    { method: 'PUT', path: `/${userId}/toggle-status`, permission: 'portal-user:update' },
    { method: 'DELETE', path: `/${userId}`, permission: 'portal-user:delete' },
  ];

  async function request(method: string, path: string, token?: string, body?: object) {
    const headers: Record<string, string> = { Connection: 'close' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminPortalUserController],
      providers: [
        { provide: AdminAuthService, useValue: authService },
        { provide: PermissionCheckService, useValue: permissionCheckService },
        { provide: PortalAuthService, useValue: portalAuthService },
        { provide: getModelToken(PortalUser.name), useValue: portalUserModel },
        { provide: getModelToken(PortalApiKey.name), useValue: portalApiKeyModel },
      ],
    }).compile();

    // Nest instantiates the controller's real guards; only external boundaries are mocked.
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = `${await app.getUrl()}/api/v1/admin/portal-users`;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    permissions.clear();
    save.mockResolvedValue(undefined);
    portalUserModel.findById.mockImplementation(async () => ({
      ...portalUser,
      deletedAt: null,
      save,
    }));
  });

  afterAll(async () => {
    await app?.close();
  });

  describe.each(['superAdmin', 'customRole'])('%s with only read permission', (token) => {
    beforeEach(() => {
      permissions.set(accounts[token].sub, new Set(['portal-user:read']));
    });

    it('can list Portal users without the admin role', async () => {
      const response = await request('GET', '', token);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        code: 0,
        data: { items: [portalUser], total: 1, page: 1, pageSize: 20 },
      });
    });

    it('can read Portal user statistics without the admin role', async () => {
      const response = await request('GET', '/stats/overview', token);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        code: 0,
        data: { totalUsers: 1, activeUsers: 1, roleStats: { user: 1 } },
      });
    });

    it.each(writeRoutes)('cannot use read permission for $method $path', async ({ method, path, body }) => {
      const response = await request(method, path, token, body);

      expect(response.status).toBe(403);
      expect(portalUserModel.findById).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(portalApiKeyModel.updateMany).not.toHaveBeenCalled();
    });
  });

  describe.each(['superAdmin', 'customRole', 'admin'])('%s without permissions', (token) => {
    it.each(readRoutes)('cannot read %s based on role alone', async (path) => {
      const response = await request('GET', path, token);

      expect(response.status).toBe(403);
      expect(portalUserModel.find).not.toHaveBeenCalled();
      expect(portalUserModel.countDocuments).not.toHaveBeenCalled();
      expect(portalUserModel.aggregate).not.toHaveBeenCalled();
    });
  });

  it.each([
    ...readRoutes.map((path) => ({ method: 'GET', path })),
    ...writeRoutes,
    { method: 'POST', path: `/${userId}/reset-password` },
  ])('rejects unauthenticated $method $path', async ({ method, path }) => {
    const response = await request(method, path);

    expect(response.status).toBe(401);
    expect(permissionCheckService.checkAllPermissions).not.toHaveBeenCalled();
    expect(permissionCheckService.checkAnyPermission).not.toHaveBeenCalled();
    expect(portalUserModel.find).not.toHaveBeenCalled();
    expect(portalUserModel.countDocuments).not.toHaveBeenCalled();
    expect(portalUserModel.findById).not.toHaveBeenCalled();
    expect(portalAuthService.resetPassword).not.toHaveBeenCalled();
  });

  it('rejects invalid authentication even when read permission exists', async () => {
    permissions.set(accounts.superAdmin.sub, new Set(['portal-user:read']));

    const response = await request('GET', '', 'invalid-token');

    expect(response.status).toBe(401);
    expect(permissionCheckService.checkAllPermissions).not.toHaveBeenCalled();
    expect(portalUserModel.find).not.toHaveBeenCalled();
  });

  it.each(writeRoutes)('allows $method $path with its own permission', async ({ method, path, permission, body }) => {
    permissions.set(accounts.customRole.sub, new Set([permission]));

    const response = await request(method, path, 'customRole', body);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ code: 0 });
    expect(save).toHaveBeenCalledTimes(1);
    if (method === 'DELETE') {
      expect(portalApiKeyModel.updateMany).toHaveBeenCalledWith(
        { userId },
        { enabled: false },
      );
    }
  });

  it.each(writeRoutes)('does not substitute another write permission for $method $path', async ({ method, path, permission, body }) => {
    const wrongPermission = permission === 'portal-user:update'
      ? 'portal-user:delete'
      : 'portal-user:update';
    permissions.set(accounts.customRole.sub, new Set([wrongPermission]));

    const response = await request(method, path, 'customRole', body);

    expect(response.status).toBe(403);
    expect(portalUserModel.findById).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(portalApiKeyModel.updateMany).not.toHaveBeenCalled();
  });

  describe('reset password', () => {
    const path = `/${userId}/reset-password`;

    it('allows a super admin with update permission and returns the password once', async () => {
      permissions.set(accounts.superAdmin.sub, new Set(['portal-user:update']));

      const response = await request('POST', path, 'superAdmin');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        code: 0,
        message: 'Password reset successfully',
        data: { temporaryPassword: 'TemporaryPass123' },
      });
      expect(portalAuthService.resetPassword).toHaveBeenCalledTimes(1);
      expect(portalAuthService.resetPassword).toHaveBeenCalledWith(userId);
      expect(portalApiKeyModel.updateMany).not.toHaveBeenCalled();
    });

    it.each(['admin', 'customRole'])('rejects %s even with update permission', async (token) => {
      permissions.set(accounts[token].sub, new Set(['portal-user:update']));

      const response = await request('POST', path, token);

      expect(response.status).toBe(403);
      expect(portalAuthService.resetPassword).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(portalApiKeyModel.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      { error: new BadRequestException('Invalid user id'), status: 400 },
      { error: new NotFoundException('User not found'), status: 404 },
    ])('preserves reset service errors as HTTP $status', async ({ error, status }) => {
      permissions.set(accounts.superAdmin.sub, new Set(['portal-user:update']));
      portalAuthService.resetPassword.mockRejectedValueOnce(error);

      const response = await request('POST', path, 'superAdmin');

      expect(response.status).toBe(status);
      expect(response.body).not.toHaveProperty('data.temporaryPassword');
    });

    it.each([{ granted: [] }, { granted: ['portal-user:read'] }, { granted: ['portal-user:delete'] }])(
      'rejects a super admin without update permission ($granted)',
      async ({ granted }) => {
        permissions.set(accounts.superAdmin.sub, new Set(granted));

        const response = await request('POST', path, 'superAdmin');

        expect(response.status).toBe(403);
        expect(portalAuthService.resetPassword).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
      },
    );
  });
});

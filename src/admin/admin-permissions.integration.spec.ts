import { Test } from '@nestjs/testing';
import { Controller, Get, Put, Delete, UseGuards, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, Connection, Schema } from 'mongoose';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { PermissionCheckService } from './permission-check.service';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { AdminAuthService } from './admin-auth.service';

@Controller('permissions-fixture')
@UseGuards(AdminJwtGuard, PermissionGuard)
class FixtureController {
  @Get() @RequirePermissions('model:read') read() { return { ok: true }; }
  @Put() @RequirePermissions('model:update') update() { return { ok: true }; }
  @Delete() @RequirePermissions('model:delete', 'provider:delete') remove() { return { ok: true }; }
}
describe('Real HTTP guards and database role permission matrix', () => {
  let mongo: MongoMemoryServer, db: Connection, app: INestApplication, origin: string;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' } }); db = await createConnection(mongo.getUri()).asPromise();
    const users = db.model('users', new Schema({}, { strict: false })), roles = db.model('roles', new Schema({}, { strict: false }));
    await roles.insertMany([{ name: 'viewer', enabled: true, permissions: ['model:read'] }, { name: 'editor', enabled: true, permissions: ['model:read', 'model:update'] }]);
    const identities: Record<string, any> = {};
    for (const role of ['viewer', 'editor', 'super_admin', 'disabled']) {
      const user = await users.create({ username: role, roles: [role === 'disabled' ? 'super_admin' : role], enabled: role !== 'disabled', deletedAt: null });
      identities[role] = { sub: String(user._id), username: role, roles: user.get('roles') };
    }
    const permissions = new PermissionCheckService(users as any, roles as any, { getUserPermissions: async () => null, setUserPermissions: async () => {} } as any);
    const module = await Test.createTestingModule({ controllers: [FixtureController], providers: [Reflector, AdminJwtGuard, PermissionGuard,
      { provide: AdminAuthService, useValue: { verifyToken: (token: string) => identities[token] } },
      { provide: PermissionCheckService, useValue: permissions },
    ] }).compile();
    app = module.createNestApplication({ logger: false }); await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
  }, 60000);
  afterAll(async () => { await app?.close(); await db?.close(); await mongo?.stop(); });
  it.each([
    ['viewer', [200, 403, 403]], ['editor', [200, 200, 403]], ['super_admin', [200, 200, 200]], ['disabled', [403, 403, 403]],
  ])('checks %s on read/update/delete over HTTP', async (role, expected) => {
    const statuses = [];
    for (const method of ['GET', 'PUT', 'DELETE']) statuses.push((await fetch(`${origin}/permissions-fixture`, { method, headers: { Authorization: `Bearer ${role}` } })).status);
    expect(statuses).toEqual(expected);
  });
  it('requires authentication before checking permissions', async () => { expect((await fetch(`${origin}/permissions-fixture`)).status).toBe(401); });
});

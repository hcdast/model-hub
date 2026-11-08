import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection, Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { RbacInitializationService } from './rbac-initialization.service';
import { Role, RoleSchema } from '../database/schemas/role.schema';
import { AdminUser, AdminUserSchema } from '../database/schemas/admin-user.schema';

describe('Concurrent RBAC startup', () => {
  let mongo: MongoMemoryServer, db: Connection, roles: Model<Role>, users: Model<AdminUser>;
  const config = { admin: { defaultUsername: 'fixture-admin', defaultPassword: 'fixture-password' } };
  const initializer = () => {
    const service = new RbacInitializationService(roles as any, users as any, config as any);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
    return service;
  };
  const startAll = async () => {
    const services = Array.from({ length: 8 }, initializer);
    await Promise.all(services.map(service => service.onModuleInit()));
    for (const service of services) expect((service as any).logger.error).not.toHaveBeenCalled();
  };
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' } });
    db = await createConnection(mongo.getUri()).asPromise();
    roles = db.model(Role.name, RoleSchema);
    users = db.model(AdminUser.name, AdminUserSchema);
    await Promise.all([roles.init(), users.init()]);
  });
  beforeEach(async () => { await Promise.all([roles.deleteMany({}), users.deleteMany({})]); });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await db?.close(); await mongo?.stop(); });

  it('creates each system role and the default administrator once during parallel cold starts', async () => {
    await startAll();
    expect(await roles.countDocuments()).toBe(4);
    expect(await users.countDocuments()).toBe(1);
    const user = await users.findOne({ username: config.admin.defaultUsername }).lean();
    expect(user).toMatchObject({ roles: ['super_admin'], enabled: true, displayName: 'Super Administrator', requirePasswordChange: false });
    expect(await bcrypt.compare(config.admin.defaultPassword, user!.passwordHash)).toBe(true);
  });

  it('updates existing role arrays without VersionError and preserves synced super-admin permissions', async () => {
    await roles.insertMany(['super_admin', 'admin', 'operator', 'viewer'].map(name => ({ name, permissions: ['synced:read'], menus: ['/old'], enabled: false, isSystem: true })));
    await startAll();
    expect(await roles.countDocuments()).toBe(4);
    const admin = await roles.findOne({ name: 'admin' }).lean();
    expect(admin!.permissions).toContain('model:update');
    expect(admin!.menus).toContain('/tasks');
    expect(admin!.enabled).toBe(false);
    expect((await roles.findOne({ name: 'super_admin' }).lean())!.permissions).toEqual(['synced:read']);
  });

  it('adds the required admin role atomically without replacing existing account settings or roles', async () => {
    const existing = await users.create({ username: config.admin.defaultUsername, passwordHash: 'existing-password-hash', roles: ['custom', 'viewer'], enabled: false, requirePasswordChange: true, displayName: 'Existing name' });
    await startAll();
    const user = await users.findById(existing._id).lean();
    expect(user).toMatchObject({ passwordHash: 'existing-password-hash', enabled: false, requirePasswordChange: true, displayName: 'Existing name' });
    expect(user!.roles).toEqual(['custom', 'viewer', 'super_admin']);
    expect(await users.countDocuments()).toBe(1);
  });

  it('preserves an account created after the initial lookup, including its password and roles', async () => {
    const existing = await users.create({ username: config.admin.defaultUsername, passwordHash: 'changed-password-hash', roles: ['custom'], enabled: false, requirePasswordChange: true });
    // Model the other process winning the insert while this process hashes its default password.
    jest.spyOn(users, 'findOne').mockResolvedValueOnce(null);
    const service = initializer();
    await service.onModuleInit();
    expect((service as any).logger.error).not.toHaveBeenCalled();
    expect(await users.findById(existing._id).lean()).toMatchObject({ passwordHash: 'changed-password-hash', roles: ['custom', 'super_admin'], enabled: false, requirePasswordChange: true });
    expect(await users.countDocuments()).toBe(1);
  });

  it.each(['role', 'user'])('recovers an exact unique-identity insert race for a %s', async kind => {
    const model = kind === 'role' ? roles : users;
    const identity = kind === 'role' ? { name: 'super_admin' } : { username: config.admin.defaultUsername };
    if (kind === 'role') await roles.create({ name: 'super_admin', permissions: ['synced:read'] });
    else {
      await users.create({ username: config.admin.defaultUsername, passwordHash: 'winner-password-hash', roles: ['custom'] });
      jest.spyOn(users, 'findOne').mockResolvedValueOnce(null);
    }
    const duplicate = Object.assign(new Error('concurrent insert'), { code: 11000, keyPattern: { [Object.keys(identity)[0]]: 1 }, keyValue: identity });
    const write = jest.spyOn(model as any, 'updateOne').mockImplementationOnce(() => Promise.reject(duplicate));
    const service = initializer();
    await service.onModuleInit();
    expect((service as any).logger.error).not.toHaveBeenCalled();
    expect(write.mock.calls[1][0]).toEqual(identity);
    expect(write.mock.calls[1][2]).toBeUndefined();
    expect(await roles.countDocuments()).toBe(4);
    expect(await users.countDocuments()).toBe(1);
  });

  it.each([
    Object.assign(new Error('unrelated unique index'), { code: 11000, keyPattern: { displayName: 1 }, keyValue: { displayName: 'existing' } }),
    new Error('database unavailable'),
  ])('reports genuine initialization errors without treating them as insert races: %s', async error => {
    const write = jest.spyOn(roles, 'updateOne').mockImplementationOnce(() => Promise.reject(error) as any);
    const service = initializer();
    await service.onModuleInit();
    expect((service as any).logger.error).toHaveBeenCalledWith('Failed to initialize RBAC system', error);
    expect(write).toHaveBeenCalledTimes(1);
    expect(await users.countDocuments()).toBe(0);
  });
});

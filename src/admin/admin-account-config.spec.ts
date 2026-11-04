import { AdminAccountPoolController } from './admin-account-pool.controller';
import { validateConfigInput } from './utils/config-input';

describe('Account configuration edit safety', () => {
  let db: any, pool: any, audit: any, controller: AdminAccountPoolController;
  const previous = { _id: 'test-id', provider_name: 'test', api_key: 'test-api-key', extra_credentials: { client_secret: 'test-client-secret' }, revision: 4 };
  beforeEach(() => {
    db = { findById: () => ({ lean: async () => previous }), findOneAndUpdate: jest.fn().mockResolvedValue({ ...previous, toObject: () => previous }) };
    pool = { refreshPool: jest.fn(), isDuplicateApiKey: jest.fn().mockResolvedValue(false) }; audit = { log: jest.fn() };
    controller = new AdminAccountPoolController(db, pool, audit);
  });
  it('preserves masked credentials on an unrelated edit and allows clearing an override URL', async () => {
    await controller.update('test-id', { expected_revision: 4, account_alias: 'new alias', base_url: '', api_key: '****-key', extra_credentials: { client_secret: 'test****' } }, { adminUser: { username: 'test' } } as any);
    expect(db.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ base_url: '', extra_credentials: previous.extra_credentials });
    expect(db.findOneAndUpdate.mock.calls[0][1].$set.api_key).toBeUndefined();
  });
  it('does not refresh or record a successful manual audit for stale/concurrent writes', async () => {
    await expect(controller.update('test-id', { expected_revision: 3 }, {} as any)).rejects.toThrow();
    db.findOneAndUpdate.mockResolvedValue(null);
    await expect(controller.update('test-id', { expected_revision: 4 }, {} as any)).rejects.toThrow();
    expect(pool.refreshPool).not.toHaveBeenCalled(); expect(audit.log).not.toHaveBeenCalled();
  });
  it.each([{ weight: NaN }, { monthly_cost_limit: -1 }, { enabled: 'false' }, { base_url: 'https://user:pass@example.com/' }, { limits: { max_concurrent: 1.5 } }, { poll_limits: { max_per_second: Infinity } }])('rejects invalid configuration %p on the server', value => {
    expect(() => validateConfigInput(value)).toThrow();
  });
});

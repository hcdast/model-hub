import { ProviderConfigService } from './provider-config.service';

describe('Provider configuration availability', () => {
  let row: any;
  let error: Error | undefined;
  let service: ProviderConfigService;
  beforeEach(() => {
    row = null; error = undefined;
    service = new ProviderConfigService({ findOne: () => ({ lean: () => ({ exec: async () => { if (error) throw error; return row; } }) }) } as any);
  });

  it('keeps a disabled provider disabled and preserves its configured endpoint and limits', async () => {
    row = { enabled: false, base_url: 'https://provider.example/api', limits: { max_per_second: 3 } };
    expect(await service.getResolved('wavespeed-ai')).toMatchObject({ enabled: false, source: 'db', baseUrl: row.base_url, limits: { maxPerSecond: 3 } });
    row.enabled = true;
    expect((await service.getResolved('wavespeed-ai')).enabled).toBe(true);
  });

  it('does not reactivate a deleted or never-configured supplier using code defaults', async () => {
    expect(service.getResolvedSync('wavespeed-ai').enabled).toBe(false);
    row = { enabled: true };
    expect((await service.getResolved('wavespeed-ai')).enabled).toBe(true);
    row = null;
    expect(await service.getResolved('wavespeed-ai')).toMatchObject({ enabled: false, source: 'defaults' });
  });

  it('preserves a known disabled state when a refresh fails', async () => {
    row = { enabled: false, base_url: 'https://provider.example/api' };
    await service.refreshOne('wavespeed-ai');
    error = new Error('temporary database failure');
    expect(await service.getResolved('wavespeed-ai')).toMatchObject({ enabled: false, baseUrl: row.base_url });
  });
});

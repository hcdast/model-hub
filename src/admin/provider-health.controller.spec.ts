import { ProviderHealthController } from './provider-health.controller';
import { CircuitState } from '../provider-health/interfaces/circuit-breaker-state.interface';
import { REGISTERED_PROVIDER_NAMES } from '../queue/queue.constants';

describe('Provider health overview membership', () => {
  let configured: Array<{ provider_name: string }>, query: any, db: any, metrics: any, circuit: any, controller: ProviderHealthController;
  beforeEach(() => {
    configured = [{ provider_name: 'akool-maas' }, { provider_name: 'akool-openapi' }];
    query = { select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn(async () => configured) };
    db = { find: jest.fn(() => query) };
    metrics = {
      getMetrics: jest.fn(async (provider: string) => ({ provider, successRate: 0, errorRate: 0, avgLatencyMs: 0, sampleCount: 0 })),
      getAllMetrics: jest.fn(async () => [{ provider: 'deleted-provider', sampleCount: 10 }]),
    };
    circuit = { getFullState: jest.fn(async () => ({ state: CircuitState.CLOSED, lastTransitionAt: null, manualOverride: null })), getAllStates: jest.fn() };
    controller = new ProviderHealthController(circuit, {} as any, metrics, db);
  });
  it('includes newly configured providers without Redis samples and ignores orphaned history', async () => {
    const result = await controller.getOverview();
    expect(result.data.items.map(item => item.provider)).toEqual(['akool-maas', 'akool-openapi']);
    expect(result.data.items[1]).toMatchObject({ sampleCount: 0, circuitState: CircuitState.CLOSED, lastTransitionAt: null, hasManualOverride: false });
    expect(db.find).toHaveBeenCalledWith({ provider_name: { $in: [...REGISTERED_PROVIDER_NAMES] } });
    expect(metrics.getAllMetrics).not.toHaveBeenCalled();
    expect(circuit.getAllStates).not.toHaveBeenCalled();
  });
  it('removes deleted providers on the very next overview read', async () => {
    await controller.getOverview();
    configured = [{ provider_name: 'akool-openapi' }];
    metrics.getMetrics.mockClear();
    const result = await controller.getOverview();
    expect(result.data.items.map(item => item.provider)).toEqual(['akool-openapi']);
    expect(metrics.getMetrics).toHaveBeenCalledTimes(1);
    expect(metrics.getMetrics).toHaveBeenCalledWith('akool-openapi');
  });
  it('returns an empty list after all configurations are deleted', async () => {
    configured = [];
    expect((await controller.getOverview()).data.items).toEqual([]);
    expect(metrics.getMetrics).not.toHaveBeenCalled();
  });
  it('retains real sampled metrics and manual override state for configured providers', async () => {
    configured = [{ provider_name: 'akool-maas' }];
    metrics.getMetrics.mockResolvedValue({ provider: 'akool-maas', successRate: 0.8, errorRate: 0.2, avgLatencyMs: 500, sampleCount: 20 });
    circuit.getFullState.mockResolvedValue({ state: CircuitState.OPEN, lastTransitionAt: '2026-11-03T13:00:00Z', manualOverride: { reason: 'maintenance' } });
    expect((await controller.getOverview()).data.items[0]).toMatchObject({ successRate: 0.8, errorRate: 0.2, avgLatencyMs: 500, sampleCount: 20, circuitState: CircuitState.OPEN, hasManualOverride: true });
  });
  it('surfaces a configuration read failure instead of falling back to deleted Redis entries', async () => {
    query.lean.mockRejectedValue(new Error('database unavailable'));
    await expect(controller.getOverview()).rejects.toThrow('database unavailable');
    expect(metrics.getAllMetrics).not.toHaveBeenCalled();
  });
});

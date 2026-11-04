import { CircuitBreakerService } from './circuit-breaker.service';
import { CircuitBreakerStore } from './circuit-breaker-store.service';
import { CircuitState } from './interfaces/circuit-breaker-state.interface';

describe('Health transition timestamps', () => {
  it('does not invent a transition when an unobserved provider is read repeatedly', async () => {
    const service = new CircuitBreakerService({ getState: async () => null } as any, {} as any, {} as any, {} as any, {} as any);
    expect((await service.getFullState('new')).lastTransitionAt).toBeNull();
    expect((await service.getFullState('new')).lastTransitionAt).toBeNull();
  });
  it('round trips an untransitioned state and preserves actual transition timestamps', () => {
    const store = new CircuitBreakerStore({} as any);
    const base = { state: CircuitState.CLOSED, openedAt: null, lastTransitionAt: null, consecutiveFailures: 1, probeSuccesses: 0, manualOverride: null };
    expect(store.deserialize(store.serialize(base))).toEqual(base);
    const transitioned = { ...base, lastTransitionAt: '2026-11-02T16:00:00.000Z' };
    expect(store.deserialize(store.serialize(transitioned))).toEqual(transitioned);
  });
});

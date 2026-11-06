import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('authentication storage recovery', () => {
  let values: Map<string, string>, storage: Storage, onStorage: (event: any) => void;
  beforeEach(() => {
    vi.resetModules(); values = new Map([['token', 'test'], ['roles', '["super_admin"]'], ['permissions', '["*"]'], ['menus', '["*"]']]);
    storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() } as any;
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { addEventListener: (_: string, listener: any) => { onStorage = listener; }, location: { reload: vi.fn() } });
  });
  afterEach(() => vi.unstubAllGlobals());
  it.each(['{bad', 'null', '"super_admin"', '["super_admin", 2]'])('fails closed for invalid permission data: %s', async invalid => {
    values.set('roles', invalid);
    const { useAuthStore } = await import('./auth');
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, token: null, roles: [], permissions: [] });
    expect(values.has('token')).toBe(false);
  });
  it('synchronizes cross-tab logout and permission changes', async () => {
    const { useAuthStore } = await import('./auth');
    values.set('permissions', '["task:read"]'); onStorage({ key: 'permissions', storageArea: storage });
    expect(useAuthStore.getState().permissions).toEqual(['task:read']);
    values.clear(); onStorage({ key: null, storageArea: storage });
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, token: null, roles: [], permissions: [] });
  });
  it('reloads after another tab switches account, discarding previous account data', async () => {
    await import('./auth'); values.set('token', 'other-account'); onStorage({ key: 'token', storageArea: storage });
    expect(window.location.reload).toHaveBeenCalledOnce();
  });
  it('keeps initialization usable when browser storage is unavailable', async () => {
    storage.getItem = () => { throw new Error('denied'); };
    const { useAuthStore } = await import('./auth'); expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

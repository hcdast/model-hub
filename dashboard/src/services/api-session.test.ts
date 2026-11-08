import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import api from './api';

describe('responses from previous admin sessions', () => {
  let values: Map<string, string>, replace: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    values = new Map([['token', 'old-token'], ['username', 'old-user'], ['roles', '[]']]); replace = vi.fn();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => values.delete(key) });
    vi.stubGlobal('window', { location: { pathname: '/api-clients', search: '?page=2', hash: '#row', replace } });
  });
  afterEach(() => vi.unstubAllGlobals());
  it.each([200, 401, 503])('ignores a stale %s without discarding the new session', async status => {
    const request = api.get('/api-clients', { adapter: async config => {
      values.set('token', 'new-token');
      const response = { config, status, statusText: 'fixture', headers: {}, data: { code: 0, data: { name: 'old account' } } };
      if (status !== 200) throw new AxiosError('fixture', undefined, config, undefined, response);
      return response;
    } });
    await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(values.get('token')).toBe('new-token'); expect(replace).not.toHaveBeenCalled();
  });
  it('does not restore data from requests completed after logout', async () => {
    await expect(api.get('/api-clients', { adapter: async config => {
      values.clear(); return { config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: { name: 'old account' } } };
    } })).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  });
  it('still expires the matching session and preserves the full return URL', async () => {
    await expect(api.get('/api-clients', { adapter: async config => { throw new AxiosError('expired', undefined, config, undefined, { config, status: 401, statusText: 'Unauthorized', headers: {}, data: {} }); } })).rejects.toMatchObject({ response: { status: 401 } });
    expect(values.has('token')).toBe(false);
    expect(replace).toHaveBeenCalledWith('/login?returnTo=%2Fapi-clients%3Fpage%3D2%23row');
  });
  it('does not expire the existing session on a failed login request', async () => {
    await expect(api.post('/auth/login', {}, { adapter: async config => { throw new AxiosError('wrong password', undefined, config, undefined, { config, status: 401, statusText: 'Unauthorized', headers: {}, data: {} }); } })).rejects.toMatchObject({ response: { status: 401 } });
    expect(values.get('token')).toBe('old-token'); expect(replace).not.toHaveBeenCalled();
  });
});

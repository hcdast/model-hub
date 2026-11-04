import { authApi, hasPortalSessionHint } from '../../portal/src/services/auth-api';

// Match the portal's Axios installation rather than the backend's separate copy.
const axios: typeof import('axios').default = require('../../portal/node_modules/axios/dist/node/axios.cjs');

describe('Portal session client', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let browserDocument: { cookie: string };

  beforeEach(() => {
    browserDocument = { cookie: '' };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: browserDocument });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });

  it.each(['', 'unrelated=value', 'portal_csrf_token=', 'portal_csrf_token=%E0%A4%A'])
  ('does not send refresh for missing or malformed CSRF cookies: %s', async (cookie) => {
    browserDocument.cookie = cookie;
    const post = jest.spyOn(axios, 'post');
    expect(hasPortalSessionHint()).toBe(false);
    await expect(authApi.refreshSession()).rejects.toThrow('No portal session to restore');
    expect(post).not.toHaveBeenCalled();
  });

  it('shares refresh requests and forwards the decoded CSRF cookie', async () => {
    browserDocument.cookie = 'other=value; portal_csrf_token=test%2Bcsrf';
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { data: { accessToken: 'restored-token' } } });
    expect(hasPortalSessionHint()).toBe(true);
    const results = await Promise.all([authApi.refreshSession(), authApi.refreshSession()]);
    expect(results).toEqual([{ data: { accessToken: 'restored-token' } }, { data: { accessToken: 'restored-token' } }]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/v1/auth/refresh', {}, {
      withCredentials: true, headers: { 'X-CSRF-Token': 'test+csrf' },
    });
  });

  it('propagates rejected sessions and permits a later restoration attempt', async () => {
    browserDocument.cookie = 'portal_csrf_token=test-csrf';
    const post = jest.spyOn(axios, 'post')
      .mockRejectedValueOnce(new Error('Expired session'))
      .mockResolvedValueOnce({ data: { data: { accessToken: 'new-token' } } });
    await expect(authApi.refreshSession()).rejects.toThrow('Expired session');
    await expect(authApi.refreshSession()).resolves.toEqual({ data: { accessToken: 'new-token' } });
    expect(post).toHaveBeenCalledTimes(2);
  });
});

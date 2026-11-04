import { getAuthReturnPath } from '../../portal/src/utils/auth-redirect';
import { useAuthStore } from '../../portal/src/store/auth-store';
import { authApi, hasPortalSessionHint, setPortalAccessToken } from '../../portal/src/services/auth-api';

jest.mock('../../portal/src/services/auth-api', () => ({
  authApi: { refreshSession: jest.fn(), getMe: jest.fn(), login: jest.fn() },
  setPortalAccessToken: jest.fn(),
  hasPortalSessionHint: jest.fn(),
}));

describe('Portal guest access', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(hasPortalSessionHint).mockReturnValue(true);
    useAuthStore.setState({ user: null, isAuthenticated: false, isInitialized: false, isLoading: false });
  });

  it('settles as a guest without requesting refresh when there is no session hint', async () => {
    jest.mocked(hasPortalSessionHint).mockReturnValue(false);
    await useAuthStore.getState().init();
    await useAuthStore.getState().init();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false, isInitialized: true, isLoading: false });
    expect(authApi.refreshSession).not.toHaveBeenCalled();
    expect(authApi.getMe).not.toHaveBeenCalled();
    expect(setPortalAccessToken).toHaveBeenCalledWith(null);
  });

  it('does not authenticate a visitor based only on a stale session hint', async () => {
    jest.mocked(authApi.refreshSession).mockRejectedValue(new Error('Expired session'));
    await useAuthStore.getState().init();
    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
    expect(authApi.getMe).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false, isInitialized: true, isLoading: false });
  });

  it('shares session restoration between simultaneous mounts and restores the account', async () => {
    const user = { id: 'user-1', username: 'Visitor' };
    jest.mocked(authApi.refreshSession).mockResolvedValue({ data: { accessToken: 'session-token' } });
    jest.mocked(authApi.getMe).mockResolvedValue({ data: user } as any);
    await Promise.all([useAuthStore.getState().init(), useAuthStore.getState().init()]);
    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
    expect(authApi.getMe).toHaveBeenCalledTimes(1);
    expect(setPortalAccessToken).toHaveBeenCalledWith('session-token');
    expect(useAuthStore.getState()).toMatchObject({ user, isAuthenticated: true, isInitialized: true, isLoading: false });
  });

  it('clears the token if account restoration fails', async () => {
    jest.mocked(authApi.refreshSession).mockResolvedValue({ data: { accessToken: 'expired-token' } });
    jest.mocked(authApi.getMe).mockRejectedValue(new Error('Account unavailable'));
    await useAuthStore.getState().init();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false, isInitialized: true });
    expect(setPortalAccessToken).toHaveBeenLastCalledWith(null);
  });

  it('does not overwrite a new login with an older session restoration', async () => {
    let finishRefresh!: (value: { data: { accessToken: string } }) => void;
    jest.mocked(authApi.refreshSession).mockImplementation(() => new Promise(resolve => { finishRefresh = resolve; }));
    const restoring = useAuthStore.getState().init();
    const user = { id: 'new-user', username: 'Signed in' };
    jest.mocked(authApi.login).mockResolvedValue({ data: { accessToken: 'new-token', user } } as any);
    await useAuthStore.getState().login('user@example.com', 'password');
    finishRefresh({ data: { accessToken: 'old-token' } });
    await restoring;
    expect(useAuthStore.getState()).toMatchObject({ user, isAuthenticated: true, isInitialized: true });
    expect(setPortalAccessToken).toHaveBeenLastCalledWith('new-token');
    expect(authApi.getMe).not.toHaveBeenCalled();
  });

  it.each([
    [{ from: '/workflows/new?template=2' }, '/workflows/new?template=2'],
    [{ from: { pathname: '/workflows', search: '?search=demo', hash: '#recent' } }, '/workflows?search=demo#recent'],
    [null, '/'],
    [{ from: 'https://example.com' }, '/'],
    [{ from: '//example.com' }, '/'],
    [{ from: '/\\example.com' }, '/'],
    [{ from: '/login' }, '/'],
    [{ from: '/register?next=1' }, '/'],
  ])('returns to the intended local page after sign-in: %j', (state, expected) => {
    expect(getAuthReturnPath(state)).toBe(expected);
  });
});

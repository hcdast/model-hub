import { HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalAuthFlowService } from './portal-auth-flow.service';
import { PortalLoginThrottleService } from './portal-login-throttle.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { APP_CONFIG } from '../config/config.module';

jest.mock('axios');
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
const RedisMock = require('ioredis-mock');

describe('Portal auth HTTP endpoints', () => {
  let app: INestApplication;
  let baseUrl: string;
  const redis = new RedisMock();
  const sendMail = jest.fn();
  const auth = { register: jest.fn(), login: jest.fn(), loginWithOAuth: jest.fn(), canResetPassword: jest.fn(), recoverPassword: jest.fn(), getRefreshCookieMaxAge: jest.fn(),
    verifyAccessToken: jest.fn(), getUserById: jest.fn(), getOAuthLinkAccount: jest.fn(), linkOAuthAccount: jest.fn() };
  const throttle = { consume: jest.fn(), consumeOAuth: jest.fn(), reset: jest.fn() };
  const session = { accessToken: 'private-access-token', refreshToken: 'private-refresh-token', user: { id: 'user', username: 'Test' } };
  const config = { portalAuth: {
    publicUrl: 'http://localhost:7004',
    google: { clientId: 'client', clientSecret: 'private-google-secret' },
    smtp: { host: 'smtp.example.com', user: 'sender', pass: 'private-smtp-secret', from: 'sender@example.com', port: 587 },
  } };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PortalAuthController], providers: [PortalAuthFlowService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: APP_CONFIG, useValue: config },
        { provide: PortalAuthService, useValue: auth },
        { provide: PortalLoginThrottleService, useValue: throttle }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  beforeEach(async () => {
    jest.resetAllMocks();
    await redis.flushall();
    jest.mocked(nodemailer.createTransport).mockReturnValue({ sendMail, close: jest.fn() } as never);
    sendMail.mockResolvedValue({});
    auth.register.mockResolvedValue(session);
    auth.login.mockResolvedValue(session);
    auth.loginWithOAuth.mockResolvedValue(session);
    auth.verifyAccessToken.mockReturnValue({ sub: 'local-user' });
    auth.getUserById.mockResolvedValue({ id: 'local-user', status: 'active' });
    auth.getOAuthLinkAccount.mockResolvedValue({ userId: 'local-user', authVersion: 3 });
    auth.linkOAuthAccount.mockResolvedValue(session);
    auth.getRefreshCookieMaxAge.mockReturnValue(14 * 24 * 60 * 60 * 1000);
  });
  afterAll(async () => {
    await app?.close(); redis.disconnect();
  });
  const post = (path: string, body: unknown) => fetch(`${baseUrl}/v1/auth/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const registerBody = { email: ' USER@example.com ', username: ' Test ', password: 'password123', acceptedTerms: true, verificationCode: '123456' };

  it('requires a real email proof and explicit terms consent before registration', async () => {
    expect((await post('register', { ...registerBody, acceptedTerms: false })).status).toBe(400);
    expect((await post('register', { ...registerBody, verificationCode: undefined })).status).toBe(400);
    expect((await post('register', registerBody)).status).toBe(400);
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('registers with a normalized verified email and returns tokens only in their intended channels', async () => {
    expect((await post('email-code', { email: registerBody.email, purpose: 'register' })).status).toBe(200);
    const verificationCode = sendMail.mock.calls[0][0].text.match(/code is (\d{6})/)[1];
    const response = await post('register', { ...registerBody, verificationCode });
    expect(response.status).toBe(201);
    expect(auth.register).toHaveBeenCalledWith('user@example.com', 'Test', 'password123');
    const body = await response.json();
    expect(body.data).toEqual({ accessToken: session.accessToken, user: session.user });
    expect(JSON.stringify(body)).not.toContain(session.refreshToken);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Strict');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=1209600');
    expect((await post('register', { ...registerBody, verificationCode })).status).toBe(400);
    expect(auth.register).toHaveBeenCalledTimes(1);
  });

  it('preserves legacy email-password login and applies throttling', async () => {
    const response = await post('login', { email: registerBody.email, password: 'password123' });
    expect(response.status).toBe(200);
    expect(auth.login).toHaveBeenCalledWith('user@example.com', 'password123', expect.any(String), expect.any(String));
    expect(throttle.consume).toHaveBeenCalled();
  });

  it('does not expose reset account existence and never allows signup codes to reset passwords', async () => {
    auth.canResetPassword.mockResolvedValue(false);
    const unknown = await post('email-code', { email: 'unknown@example.com', purpose: 'reset-password' });
    expect(unknown.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
    auth.canResetPassword.mockResolvedValue(true);
    const known = await post('email-code', { email: 'known@example.com', purpose: 'reset-password' });
    expect(await known.json()).toEqual(await unknown.json());
    const verificationCode = sendMail.mock.calls[0][0].text.match(/code is (\d{6})/)[1];
    expect((await post('register', { ...registerBody, email: 'known@example.com', verificationCode })).status).toBe(400);
    expect((await post('reset-password', { email: 'known@example.com', verificationCode, password: 'new-password' })).status).toBe(200);
    expect(auth.recoverPassword).toHaveBeenCalledWith('known@example.com', 'new-password');
  });

  it('round-trips OAuth using a browser-bound cookie and redirects without exposing any tokens', async () => {
    const start = await fetch(`${baseUrl}/v1/auth/oauth/google?returnTo=${encodeURIComponent('/workflows/new?template=1')}`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    expect(throttle.consumeOAuth).toHaveBeenCalledWith('127.0.0.1');
    expect(throttle.consume).not.toHaveBeenCalled();
    const location = new URL(start.headers.get('location')!);
    const state = location.searchParams.get('state');
    const cookie = start.headers.get('set-cookie')!.split(';')[0];
    expect(start.headers.get('set-cookie')).toContain('HttpOnly');
    expect(start.headers.get('set-cookie')).toContain('SameSite=Lax');
    jest.mocked(axios.post).mockResolvedValue({ data: { access_token: 'private-provider-token' } });
    jest.mocked(axios.get).mockResolvedValue({ data: { sub: 'provider-user', email: 'person@example.com', email_verified: true } });
    const callback = await fetch(`${baseUrl}/v1/auth/oauth/google/callback?state=${state}&code=provider-code`, { redirect: 'manual', headers: { Cookie: cookie } });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('http://localhost:7004/auth/callback?returnTo=%2Fworkflows%2Fnew%3Ftemplate%3D1');
    expect(callback.headers.get('location')).not.toMatch(/private-|provider-code/);
    expect(callback.headers.get('set-cookie')).toContain('portal_refresh_token=private-refresh-token');
    expect(callback.headers.get('cache-control')).toBe('no-store');
    expect(auth.loginWithOAuth).toHaveBeenCalledTimes(1);
    const replay = await fetch(`${baseUrl}/v1/auth/oauth/google/callback?state=${state}&code=provider-code`, { redirect: 'manual', headers: { Cookie: cookie } });
    expect(replay.headers.get('location')).toBe('http://localhost:7004/login?error=oauth_failed');
    expect(auth.loginWithOAuth).toHaveBeenCalledTimes(1);
  });

  it('requires an authenticated local account and CSRF proof to start linking', async () => {
    expect((await post('oauth/google/link', {})).status).toBe(401);
    const withoutCsrf = await fetch(`${baseUrl}/v1/auth/oauth/google/link`, { method: 'POST', headers: { Authorization: 'Bearer local-token' } });
    expect(withoutCsrf.status).toBe(403);
    expect(auth.getOAuthLinkAccount).not.toHaveBeenCalled();
  });

  it('returns OAuth throttling to the login page with an actual retry delay and a safe destination', async () => {
    throttle.consumeOAuth.mockRejectedValue(new HttpException({ message: 'private redis details', retryAfter: 37 }, 429));
    const destination = '/workflows/new?template=1#prompt';
    const response = await fetch(`${baseUrl}/v1/auth/oauth/google?returnTo=${encodeURIComponent(destination)}`, { redirect: 'manual' });
    expect(response.status).toBe(303);
    const url = new URL(response.headers.get('location')!);
    expect(url.origin + url.pathname).toBe('http://localhost:7004/login');
    expect(url.searchParams.get('error')).toBe('oauth_rate_limited');
    expect(url.searchParams.get('returnTo')).toBe(destination);
    expect(url.searchParams.get('retryAfter')).toBe('37');
    expect(response.headers.get('retry-after')).toBe('37');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await response.text()).not.toContain('private');
    expect(await redis.keys('portal:oauth:*')).toEqual([]);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each(['https://attacker.example/', '//attacker.example/', '/login', '/\\attacker.example/'])('sanitizes the error redirect destination: %s', async destination => {
    throttle.consumeOAuth.mockRejectedValue(new HttpException('rate limited', 429));
    const response = await fetch(`${baseUrl}/v1/auth/oauth/google?returnTo=${encodeURIComponent(destination)}`, { redirect: 'manual' });
    const url = new URL(response.headers.get('location')!);
    expect(url.searchParams.get('returnTo')).toBe('/');
    expect(url.searchParams.get('retryAfter')).toBe('900');
  });

  it('returns an unavailable provider to a recoverable login page', async () => {
    const response = await fetch(`${baseUrl}/v1/auth/oauth/github?returnTo=%2Fworks`, { redirect: 'manual' });
    expect(response.status).toBe(303);
    const url = new URL(response.headers.get('location')!);
    expect(url.searchParams.get('error')).toBe('oauth_unavailable');
    expect(url.searchParams.get('returnTo')).toBe('/works');
    expect(response.headers.get('retry-after')).toBeNull();
    expect(await response.text()).not.toContain('secret');
  });

  it('links the server-selected authenticated account after a fresh Google proof, never a body or query user ID', async () => {
    const start = await fetch(`${baseUrl}/v1/auth/oauth/google/link?userId=attacker`, {
      method: 'POST', headers: { Authorization: 'Bearer local-token', Cookie: 'portal_csrf_token=proof', 'X-CSRF-Token': 'proof' },
    });
    expect(start.status).toBe(200);
    expect(auth.getOAuthLinkAccount).toHaveBeenCalledWith('local-user');
    const { data } = await start.json();
    const state = new URL(data.url).searchParams.get('state');
    const cookie = start.headers.get('set-cookie')!.split(';')[0];
    jest.mocked(axios.post).mockResolvedValue({ data: { access_token: 'provider-token' } });
    jest.mocked(axios.get).mockResolvedValue({ data: { sub: 'google-user', email: 'person@example.com', email_verified: true } });
    const callback = await fetch(`${baseUrl}/v1/auth/oauth/google/callback?state=${state}&code=code&userId=attacker`, { redirect: 'manual', headers: { Cookie: cookie } });
    expect(callback.headers.get('location')).toBe('http://localhost:7004/auth/callback?returnTo=%2Fprofile%3Foauth%3Dlinked');
    expect(auth.linkOAuthAccount).toHaveBeenCalledWith('google', expect.objectContaining({ id: 'google-user' }), { userId: 'local-user', authVersion: 3 }, expect.any(String), expect.any(String));
    expect(auth.loginWithOAuth).not.toHaveBeenCalled();
    const replay = await fetch(`${baseUrl}/v1/auth/oauth/google/callback?state=${state}&code=code`, { redirect: 'manual', headers: { Cookie: cookie } });
    expect(replay.headers.get('location')).toContain('oauth_failed');
    expect(auth.linkOAuthAccount).toHaveBeenCalledTimes(1);
  });

  it('returns cancelled linking to Profile without issuing a session or linking an account', async () => {
    const start = await fetch(`${baseUrl}/v1/auth/oauth/google/link`, {
      method: 'POST', headers: { Authorization: 'Bearer local-token', Cookie: 'portal_csrf_token=proof', 'X-CSRF-Token': 'proof' },
    });
    const { data } = await start.json();
    const state = new URL(data.url).searchParams.get('state');
    const cookie = start.headers.get('set-cookie')!.split(';')[0];
    const callback = await fetch(`${baseUrl}/v1/auth/oauth/google/callback?state=${state}&error=access_denied`, { redirect: 'manual', headers: { Cookie: cookie } });
    expect(callback.headers.get('location')).toBe('http://localhost:7004/profile?oauth=link_failed');
    expect(auth.linkOAuthAccount).not.toHaveBeenCalled();
    expect(auth.loginWithOAuth).not.toHaveBeenCalled();
    expect(callback.headers.get('set-cookie')).not.toContain('portal_refresh_token');
  });
});

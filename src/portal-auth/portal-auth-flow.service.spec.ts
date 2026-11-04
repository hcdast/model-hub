import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
import { PortalAuthFlowService } from './portal-auth-flow.service';
import { AppConfig } from '../config/interfaces/config.interface';

jest.mock('axios');
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
const RedisMock = require('ioredis-mock');
const portalAuth = {
  publicUrl: 'http://localhost:7004',
  google: { clientId: 'google-client', clientSecret: 'google-secret' },
  github: { clientId: 'github-client', clientSecret: 'github-secret' },
  smtp: { host: 'smtp.example.com', user: 'sender', pass: 'smtp-secret', from: 'no-reply@example.com', port: 587 },
};

describe('Portal email and OAuth proofs (Redis Lua)', () => {
  let redis: any;
  let service: PortalAuthFlowService;
  let config: AppConfig;
  const sendMail = jest.fn();
  const close = jest.fn();
  beforeEach(async () => {
    config = { portalAuth: structuredClone(portalAuth) } as AppConfig;
    jest.resetAllMocks();
    redis = new RedisMock();
    await redis.flushall();
    service = new PortalAuthFlowService(redis, config);
    jest.mocked(nodemailer.createTransport).mockReturnValue({ sendMail, close } as never);
    sendMail.mockResolvedValue({});
  });
  afterEach(() => redis.disconnect());

  async function emailProof() {
    await service.reserveEmail('user@example.com', 'register', '127.0.0.1');
    await service.sendEmailCode(' USER@example.com ', 'register');
    const text = sendMail.mock.calls[0][0].text as string;
    return text.match(/code is (\d{6})/)![1];
  }

  it('stores a hash with a ten-minute TTL and consumes the normalized-email proof only once, even concurrently', async () => {
    const code = await emailProof();
    const [key] = (await redis.keys('portal:email-code:register:*')).filter((item: string) => !item.endsWith(':cooldown'));
    expect(JSON.stringify(await redis.hgetall(key))).not.toContain(code);
    expect(await redis.ttl(key)).toBeGreaterThanOrEqual(599);
    const results = await Promise.allSettled([
      service.consumeEmailCode('user@example.com', 'register', code),
      service.consumeEmailCode(' USER@example.com ', 'register', code),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(close).toHaveBeenCalled();
  });

  it('rejects cross-purpose proofs and invalidates after five wrong attempts without extending the TTL', async () => {
    const code = await emailProof();
    await expect(service.consumeEmailCode('user@example.com', 'reset-password', code)).rejects.toBeInstanceOf(BadRequestException);
    const wrong = code === '000000' ? '111111' : '000000';
    const [key] = (await redis.keys('portal:email-code:register:*')).filter((item: string) => !item.endsWith(':cooldown'));
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(service.consumeEmailCode('user@example.com', 'register', wrong)).rejects.toBeInstanceOf(BadRequestException);
      if (attempt < 4) expect(await redis.ttl(key)).toBeGreaterThanOrEqual(599);
    }
    await expect(service.consumeEmailCode('user@example.com', 'register', code)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces resend cooldown and per-email hourly limits across purposes', async () => {
    await service.reserveEmail('user@example.com', 'register', '127.0.0.1');
    await expect(service.reserveEmail('user@example.com', 'register', '127.0.0.1')).rejects.toMatchObject({ status: 429 });
    for (let count = 1; count < 10; count++) {
      const cooldownKeys = await redis.keys('*:cooldown');
      await redis.del(...cooldownKeys);
      await service.reserveEmail('user@example.com', count % 2 ? 'reset-password' : 'register', '127.0.0.1');
    }
    await redis.del(...await redis.keys('*:cooldown'));
    await expect(service.reserveEmail('user@example.com', 'register', '127.0.0.1')).rejects.toMatchObject({ status: 429 });
  });

  it('deletes unsent proof and hides SMTP credentials on delivery failure', async () => {
    sendMail.mockRejectedValue(new Error('smtp-secret'));
    await expect(service.sendEmailCode('user@example.com', 'register')).rejects.toThrow('Unable to send email');
    expect(await redis.keys('portal:email-code:register:*')).toHaveLength(0);
    expect(close).toHaveBeenCalled();
  });

  it('fails closed on Redis outage and reports unavailable providers without revealing secrets', async () => {
    redis.eval = jest.fn().mockRejectedValue(new Error('redis-password'));
    await expect(service.reserveEmail('user@example.com', 'register')).rejects.toBeInstanceOf(ServiceUnavailableException);
    config.portalAuth!.google!.clientSecret = '';
    expect(service.providers()).toEqual({ google: false, github: true, email: true });
    await expect(service.startOAuth('google', '/')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  async function oauthStart(provider: 'google' | 'github' = 'google') {
    const start = await service.startOAuth(provider, '/workflows/new?template=1');
    const url = new URL(start.url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(`http://localhost:7004/api/v1/auth/oauth/${provider}/callback`);
    expect(start.url).not.toContain('secret');
    return { state: url.searchParams.get('state'), binding: start.binding };
  }

  it('binds OAuth state to provider and browser, exchanges PKCE verifier and rejects replay', async () => {
    const { state, binding } = await oauthStart();
    await expect(service.finishOAuth('google', state, 'wrong-browser', 'code', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.finishOAuth('github', state, binding, 'code', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(axios.post).not.toHaveBeenCalled();
    jest.mocked(axios.post).mockResolvedValue({ data: { access_token: 'provider-token' } });
    jest.mocked(axios.get).mockResolvedValue({ data: { sub: 'google-user', email: 'User@example.com', email_verified: true, name: 'User' } });
    const result = await service.finishOAuth('google', state, binding, 'code', undefined);
    expect(result).toMatchObject({ profile: { id: 'google-user', email: 'user@example.com' }, returnTo: '/workflows/new?template=1' });
    const params = new URLSearchParams(String(jest.mocked(axios.post).mock.calls[0][1]));
    expect(params.get('code_verifier')).toMatch(/^[\w-]{43}$/);
    await expect(service.finishOAuth('google', state, binding, 'code', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('rejects unverified Google email, cancelled authorization, missing and expired state', async () => {
    let start = await oauthStart();
    jest.mocked(axios.post).mockResolvedValue({ data: { access_token: 'token' } });
    jest.mocked(axios.get).mockResolvedValue({ data: { sub: 'user', email: 'user@example.com', email_verified: false } });
    await expect(service.finishOAuth('google', start.state, start.binding, 'code', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    start = await oauthStart();
    await expect(service.finishOAuth('google', start.state, start.binding, undefined, 'access_denied')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.finishOAuth('google', start.state, start.binding, 'code', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    start = await oauthStart();
    await redis.del(`portal:oauth:${start.state}`);
    await expect(service.finishOAuth('google', start.state, start.binding, 'code', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.finishOAuth('google', undefined, undefined, 'code', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps the authenticated link target only in one-time browser-bound Redis state', async () => {
    const account = { userId: 'local-user-id', authVersion: 7 };
    const start = await service.startOAuth('google', '/profile?oauth=linked', account);
    const state = new URL(start.url).searchParams.get('state');
    expect(start.url).not.toContain(account.userId);
    expect(JSON.parse(await redis.hget(`portal:oauth:${state}`, 'payload')).linkAccount).toEqual(account);
    expect(await redis.ttl(`portal:oauth:${state}`)).toBeGreaterThanOrEqual(599);
    jest.mocked(axios.post).mockResolvedValue({ data: { access_token: 'token' } });
    jest.mocked(axios.get).mockResolvedValue({ data: { sub: 'google-user', email: 'user@example.com', email_verified: true } });
    await expect(service.finishOAuth('google', state, 'wrong-browser', 'code', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.finishOAuth('google', state, start.binding, 'code', undefined)).resolves.toMatchObject({ linkAccount: account, returnTo: '/profile?oauth=linked' });
    await expect(service.finishOAuth('google', state, start.binding, 'code', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses verified GitHub private primary email rather than untrusted public profile email', async () => {
    const { state, binding } = await oauthStart('github');
    jest.mocked(axios.post).mockResolvedValue({ data: { access_token: 'token' } });
    jest.mocked(axios.get).mockResolvedValueOnce({ data: { id: 42, login: 'octocat', email: 'wrong@example.com' } })
      .mockResolvedValueOnce({ data: [
        { email: 'unverified@example.com', verified: false, primary: true },
        { email: 'secondary@example.com', verified: true, primary: false },
        { email: 'private@example.com', verified: true, primary: true },
      ] });
    const result = await service.finishOAuth('github', state, binding, 'code', undefined);
    expect(result.profile).toMatchObject({ id: '42', email: 'private@example.com' });
  });

  it.each(['//evil.example', '/\\evil.example', '/\t/evil.example', 'https://evil.example', '/auth/callback', '/login', '/forgot-password'])
  ('rejects unsafe or recursive post-login destination %j', value => {
    expect(service.returnPath(value)).toBe('/');
  });
});

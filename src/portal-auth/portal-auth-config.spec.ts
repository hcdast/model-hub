import { PortalAuthService } from './portal-auth.service';
import { PortalAuthFlowService } from './portal-auth-flow.service';
import { AppConfig, PortalAuthConfig } from '../config/interfaces/config.interface';
import * as nodemailer from 'nodemailer';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('Portal APP_CONFIG configuration', () => {
  const env = {
    PORTAL_JWT_SECRET: 'old-environment-secret-at-least-32-bytes',
    PORTAL_ACCESS_TOKEN_EXPIRES: '1h',
    PORTAL_REFRESH_TOKEN_EXPIRES_DAYS: '30',
    PORTAL_PUBLIC_URL: 'https://old-env.example.com',
    PORTAL_GOOGLE_CLIENT_ID: 'old-client', PORTAL_GOOGLE_CLIENT_SECRET: 'old-secret',
    PORTAL_SMTP_HOST: 'old-smtp.example.com', PORTAL_SMTP_PORT: '465',
    PORTAL_SMTP_USER: 'old-user', PORTAL_SMTP_PASS: 'old-password', PORTAL_SMTP_FROM: 'old@example.com',
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const appConfig = (portalAuth: PortalAuthConfig): AppConfig => ({ portalAuth } as AppConfig);
  beforeAll(() => Object.assign(process.env, env));
  afterAll(() => Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }));

  it('uses configured JWT signing key, access expiry and refresh cookie lifetime despite conflicting environment values', () => {
    const config = appConfig({ jwtSecret: 'config-signing-secret-at-least-32-bytes', accessTokenExpires: '5m', refreshTokenExpiresDays: 14 });
    const service = new PortalAuthService({} as never, {} as never, config);
    const token = (service as any).signAccessToken({ sub: 'user' });
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.exp - payload.iat).toBe(300);
    expect(service.getRefreshCookieMaxAge()).toBe(14 * 24 * 60 * 60 * 1000);
    expect(service.verifyAccessToken(token).sub).toBe('user');
    const other = new PortalAuthService({} as never, {} as never, appConfig({ jwtSecret: env.PORTAL_JWT_SECRET }));
    expect(() => other.verifyAccessToken(token)).toThrow('Invalid or expired token');
  });

  it.each([
    { jwtSecret: 'short' },
    { accessTokenExpires: '30s' },
    { refreshTokenExpiresDays: 0 },
    { refreshTokenExpiresDays: 366 },
    { refreshTokenExpiresDays: 1.5 },
  ])('validates portalAuth settings at startup: %j', values => {
    expect(() => new PortalAuthService({} as never, {} as never, appConfig(values))).toThrow(/portalAuth\./);
  });

  it('keeps OAuth and SMTP disabled when only obsolete environment settings exist', () => {
    const service = new PortalAuthFlowService({} as never, {} as AppConfig);
    expect(service.providers()).toEqual({ google: false, github: false, email: false });
  });

  it('builds OAuth client and callback exclusively from the supplied JSON config', async () => {
    const config = appConfig({ publicUrl: 'https://hub.example.com', google: { clientId: 'config-client', clientSecret: 'config-secret' } });
    const redis = { eval: jest.fn().mockResolvedValue(1) };
    const service = new PortalAuthFlowService(redis as never, config);
    const result = await service.startOAuth('google', '/');
    const url = new URL(result.url);
    expect(url.searchParams.get('client_id')).toBe('config-client');
    expect(url.searchParams.get('redirect_uri')).toBe('https://hub.example.com/api/v1/auth/oauth/google/callback');
    expect(url.toString()).not.toContain('old-');
  });

  it('sends email using SMTP config rather than environment settings', async () => {
    const smtp = { host: 'config-smtp.example.com', port: 587, user: 'config-user', pass: 'config-password', from: 'config@example.com' };
    const sendMail = jest.fn().mockResolvedValue({});
    jest.mocked(nodemailer.createTransport).mockReturnValue({ sendMail, close: jest.fn() } as never);
    const service = new PortalAuthFlowService({ eval: jest.fn().mockResolvedValue(1) } as never, appConfig({ smtp }));
    await service.sendEmailCode('recipient@example.com', 'register');
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: smtp.host, port: smtp.port, secure: false, requireTLS: true, auth: { user: smtp.user, pass: smtp.pass } }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: smtp.from }));
  });
});

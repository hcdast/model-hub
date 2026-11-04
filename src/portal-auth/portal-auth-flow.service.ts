import {
  BadRequestException, HttpException, HttpStatus, Inject, Injectable,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';
import axios from 'axios';
import Redis from 'ioredis';
import * as nodemailer from 'nodemailer';
import { isEmail } from 'class-validator';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';

export type OAuthProvider = 'google' | 'github';
export interface OAuthLinkAccount { userId: string; authVersion: number }
export class OAuthLinkCallbackException extends UnauthorizedException {
  constructor() { super('Unable to verify account linking'); }
}
export type EmailPurpose = 'register' | 'reset-password';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const CODE_TTL = 600;
const RESERVE_MAIL = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
local emailCount = redis.call('INCR', KEYS[2])
if emailCount == 1 then redis.call('EXPIRE', KEYS[2], 3600) end
local ipCount = redis.call('INCR', KEYS[3])
if ipCount == 1 then redis.call('EXPIRE', KEYS[3], 3600) end
if emailCount > 10 or ipCount > 30 then return 0 end
redis.call('SET', KEYS[1], '1', 'EX', 60)
return 1
`;
const CONSUME_CODE = `
local value = redis.call('HGET', KEYS[1], 'hash')
if not value then return 0 end
if value == ARGV[1] then redis.call('DEL', KEYS[1]); return 1 end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts >= 5 then redis.call('DEL', KEYS[1]) end
return 0
`;
const CONSUME_STATE = `
if redis.call('HGET', KEYS[1], 'bindingHash') ~= ARGV[1] or
  redis.call('HGET', KEYS[1], 'provider') ~= ARGV[2] then return nil end
local value = redis.call('HGET', KEYS[1], 'payload')
redis.call('DEL', KEYS[1])
return value
`;

/** Short-lived proofs live in shared Redis so callbacks work across API replicas. */
@Injectable()
export class PortalAuthFlowService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  providers() {
    return {
      google: this.oauthEnabled('google'),
      github: this.oauthEnabled('github'),
      email: this.emailEnabled(),
    };
  }

  private emailEnabled(): boolean {
    const smtp = this.config.portalAuth?.smtp;
    return [smtp?.host, smtp?.user, smtp?.pass, smtp?.from].every(value => !!value?.trim());
  }

  private oauthEnabled(provider: OAuthProvider): boolean {
    const oauth = this.config.portalAuth?.[provider];
    try { this.publicUrl(); } catch { return false; }
    return !!oauth?.clientId?.trim() && !!oauth?.clientSecret?.trim();
  }

  publicUrl(): string {
    try {
      const url = new URL(this.config.portalAuth?.publicUrl || '');
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:'))) throw new Error();
      return url.origin;
    } catch {
      throw new ServiceUnavailableException('Portal authentication is not configured');
    }
  }

  returnPath(value: unknown): string {
    if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') ||
      value.startsWith('//') || /[\\\s\u0000-\u001f]/.test(value) ||
      /^\/(login|register|auth|forgot-password)([/?#]|$)/i.test(value)) return '/';
    return value;
  }

  private codeKey(email: string, purpose: EmailPurpose): string {
    return `portal:email-code:${purpose}:${hash(email.trim().toLowerCase())}`;
  }

  /** Also reserve for unknown reset accounts, keeping response and throttling identical. */
  async reserveEmail(email: string, purpose: EmailPurpose, ip?: string): Promise<void> {
    if (!this.emailEnabled()) throw new ServiceUnavailableException('Email service is currently unavailable');
    const key = this.codeKey(email, purpose);
    const allowed = await this.storage(() => this.redis.eval(RESERVE_MAIL, 3,
      `${key}:cooldown`, `portal:mail:email:${hash(email.trim().toLowerCase())}`,
      `portal:mail:ip:${hash(ip || 'unknown')}`));
    if (Number(allowed) !== 1) throw new HttpException('Please wait before requesting another code', HttpStatus.TOO_MANY_REQUESTS);
  }

  async sendEmailCode(email: string, purpose: EmailPurpose): Promise<void> {
    email = email.trim().toLowerCase();
    const smtp = this.config.portalAuth?.smtp;
    const port = Number(smtp?.port ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ServiceUnavailableException('Email service is currently unavailable');
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const key = this.codeKey(email, purpose);
    const codeHash = hash(`${key}:${code}`);
    await this.storage(() => this.redis.eval(`
      redis.call('HSET', KEYS[1], 'hash', ARGV[1], 'attempts', 0)
      return redis.call('EXPIRE', KEYS[1], ARGV[2])
    `, 1, key, codeHash, CODE_TTL));
    const transporter = nodemailer.createTransport({
      host: smtp?.host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: smtp?.user, pass: smtp?.pass },
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
    try {
      await transporter.sendMail({
        from: smtp?.from,
        to: email,
        subject: purpose === 'register' ? 'Verify your Model Hub email' : 'Reset your Model Hub password',
        text: `Your Model Hub ${purpose === 'register' ? 'registration' : 'password reset'} code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
      });
    } catch {
      await this.storage(() => this.redis.eval(
        "if redis.call('HGET', KEYS[1], 'hash') == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, key, codeHash));
      // Never surface provider errors: SMTP errors may contain credentials or recipient data.
      throw new ServiceUnavailableException('Unable to send email. Please try again later');
    } finally {
      transporter.close();
    }
  }

  async consumeEmailCode(email: string, purpose: EmailPurpose, code: string): Promise<void> {
    const key = this.codeKey(email, purpose);
    const valid = await this.storage(() => this.redis.eval(CONSUME_CODE, 1, key, hash(`${key}:${code}`)));
    if (Number(valid) !== 1) throw new BadRequestException('Invalid or expired verification code');
  }

  async startOAuth(provider: OAuthProvider, returnTo: unknown, linkAccount?: OAuthLinkAccount) {
    const config = this.oauthConfig(provider);
    const state = randomBytes(32).toString('base64url');
    const binding = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    await this.storage(() => this.redis.eval(`
      redis.call('HSET', KEYS[1], 'provider', ARGV[1], 'bindingHash', ARGV[2], 'payload', ARGV[3])
      return redis.call('EXPIRE', KEYS[1], 600)
    `, 1, `portal:oauth:${state}`, provider, hash(binding), JSON.stringify({ verifier, returnTo: this.returnPath(returnTo), linkAccount })));
    const url = new URL(provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: provider === 'google' ? 'openid email profile' : 'read:user user:email',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      ...(provider === 'google' ? { prompt: 'select_account' } : {}),
    }).toString();
    return { url: url.toString(), binding };
  }

  async finishOAuth(provider: OAuthProvider, state: unknown, binding: string | undefined, code: unknown, error: unknown) {
    if (typeof state !== 'string' || !/^[\w-]{43}$/.test(state) || !binding) throw new UnauthorizedException('Invalid OAuth state');
    const raw = await this.storage(() => this.redis.eval(CONSUME_STATE, 1, `portal:oauth:${state}`, hash(binding), provider));
    if (typeof raw !== 'string') throw new UnauthorizedException('Invalid OAuth state');
    const saved = JSON.parse(raw) as { verifier: string; returnTo: string; linkAccount?: OAuthLinkAccount };
    if (error) throw saved.linkAccount ? new OAuthLinkCallbackException() : new BadRequestException('OAuth authorization was cancelled');
    if (typeof code !== 'string' || code.length > 2048 || !code) {
      throw saved.linkAccount ? new OAuthLinkCallbackException() : new BadRequestException('Missing OAuth code');
    }
    const config = this.oauthConfig(provider);
    try {
      const { data: token } = await axios.post(
        provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token',
        new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
          redirect_uri: config.redirectUri, code, grant_type: 'authorization_code', code_verifier: saved.verifier }).toString(),
        { timeout: 10000, maxRedirects: 0, headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      if (typeof token.access_token !== 'string' || token.error) throw new Error();
      const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json', 'User-Agent': 'Model-Hub' };
      let profile: { id: string; email: string; username: string; avatar?: string };
      if (provider === 'google') {
        const { data } = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', { headers, timeout: 10000, maxRedirects: 0 });
        if (data.email_verified !== true || typeof data.sub !== 'string' || !data.sub) throw new Error();
        profile = { id: data.sub, email: data.email, username: data.name || 'user', avatar: data.picture };
      } else {
        const { data: user } = await axios.get('https://api.github.com/user', { headers, timeout: 10000, maxRedirects: 0 });
        const { data: emails } = await axios.get('https://api.github.com/user/emails', { headers, timeout: 10000, maxRedirects: 0 });
        const email = Array.isArray(emails) && (emails.find(item => item.primary === true && item.verified === true) || emails.find(item => item.verified === true));
        if (!email || !Number.isSafeInteger(user.id) || user.id <= 0) throw new Error();
        profile = { id: String(user.id), email: email.email, username: user.login || 'user', avatar: user.avatar_url };
      }
      if (typeof profile.email !== 'string' || !isEmail(profile.email)) throw new Error();
      profile.email = profile.email.trim().toLowerCase();
      return { profile, returnTo: this.returnPath(saved.returnTo), linkAccount: saved.linkAccount };
    } catch {
      if (saved.linkAccount) throw new OAuthLinkCallbackException();
      throw new UnauthorizedException('Unable to verify OAuth identity');
    }
  }

  private oauthConfig(provider: OAuthProvider) {
    if (provider !== 'google' && provider !== 'github') throw new BadRequestException('Unsupported OAuth provider');
    if (!this.oauthEnabled(provider)) throw new ServiceUnavailableException('This sign-in method is currently unavailable');
    const oauth = this.config.portalAuth![provider]!;
    return { clientId: oauth.clientId!.trim(), clientSecret: oauth.clientSecret!.trim(),
      redirectUri: `${this.publicUrl()}/api/v1/auth/oauth/${provider}/callback` };
  }

  private async storage<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch { throw new ServiceUnavailableException('Authentication is temporarily unavailable'); }
  }
}

import { createHmac } from 'crypto';

/** 与 AGI-Content util_v2.gen_token(team_id, uid, ttl) 对齐的 JWT */
export function signAlgorithmQueueJwt(
  teamId: string | number,
  uid: string | number,
  secret: string,
  expiresInSec = 300,
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      id: '1',
      team_id: teamId,
      uid,
      type: 'user',
      iat: now,
      exp: now + expiresInSec,
    }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function resolveAlgorithmQueueAuth(
  account: { api_key?: string; extra_credentials?: Record<string, unknown> } | null | undefined,
  teamId: string | number,
  uid: string | number,
): string | null {
  if (!account) return null;
  const extra = account.extra_credentials ?? {};
  const jwtSecret =
    (extra.jwt_secret as string | undefined)
    ?? (extra.algorithm_jwt_secret as string | undefined);
  if (jwtSecret && String(jwtSecret).trim()) {
    return signAlgorithmQueueJwt(teamId, uid, String(jwtSecret).trim());
  }
  const apiKey = account.api_key != null ? String(account.api_key).trim() : '';
  return apiKey || null;
}

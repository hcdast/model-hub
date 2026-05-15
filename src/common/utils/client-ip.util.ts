import type { Request } from 'express';

/**
 * 从反向代理链解析客户端 IP（解析 X-Forwarded-For 逗号分隔层级）。
 * 不依赖 Express trust proxy 设置：始终直接读取 XFF 头。
 */
export interface ResolvedClientIp {
  /** 最左侧 hop，一般为原始客户端（RFC 7239 常见用法） */
  clientIp: string;
  /** 代理链从左到右：客户端 → 代理1 → 代理2 … */
  ipChain: string[];
  /** 原始 X-Forwarded-For 头 */
  forwardedForRaw?: string;
  /** TCP 对端地址 */
  remoteAddress?: string;
}

function normalizeIp(ip: string): string {
  const t = ip.trim();
  if (t.startsWith('::ffff:')) return t.slice(7);
  return t;
}

export function resolveClientIp(request: Request): ResolvedClientIp {
  const raw = request.headers['x-forwarded-for'];
  let ipChain: string[] = [];
  let forwardedForRaw: string | undefined;

  if (typeof raw === 'string' && raw.trim()) {
    forwardedForRaw = raw;
    ipChain = raw
      .split(',')
      .map((s) => normalizeIp(s))
      .filter((s) => s.length > 0 && s.toLowerCase() !== 'unknown');
  } else if (Array.isArray(raw)) {
    forwardedForRaw = raw.join(', ');
    ipChain = raw
      .flatMap((part) => part.split(','))
      .map((s) => normalizeIp(s))
      .filter((s) => s.length > 0 && s.toLowerCase() !== 'unknown');
  }

  const remoteAddress = request.socket?.remoteAddress
    ? normalizeIp(request.socket.remoteAddress)
    : undefined;

  let clientIp = ipChain[0] || '';
  if (!clientIp && typeof request.ip === 'string' && request.ip.trim()) {
    clientIp = normalizeIp(request.ip);
  }
  if (!clientIp && remoteAddress) {
    clientIp = remoteAddress;
  }

  return {
    clientIp,
    ipChain,
    forwardedForRaw,
    remoteAddress,
  };
}

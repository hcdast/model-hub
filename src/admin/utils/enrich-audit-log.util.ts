/**
 * 对历史/不完整审计文档做「读时补全」，便于列表与详情展示一致。
 * 不修改数据库；仅合并到 API 返回对象。
 */

function stripIpv4Mapped(ip: string): string {
  const t = ip.trim();
  if (t.startsWith('::ffff:')) return t.slice(7);
  return t;
}

function parseXffChain(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => stripIpv4Mapped(s))
    .filter((s) => s.length > 0 && s.toLowerCase() !== 'unknown');
}

/**
 * 与 AuditInterceptor.inferOperationKind 语义对齐；兼容无 detail.method 的旧记录。
 */
export function inferAuditOperationKind(
  method: unknown,
  action: string | undefined,
): string {
  const tail = (action || '').split('.').pop() || '';
  const h = tail.toLowerCase();
  if (h.includes('credit') || h.includes('recharge') || h.includes('topup')) {
    return 'credit';
  }

  const m = typeof method === 'string' ? method.toUpperCase() : '';

  if (m) {
    if (m === 'DELETE') return 'delete';
    if (m === 'PUT' || m === 'PATCH') return 'update';
    if (m === 'POST') {
      if (h.includes('reset')) return 'reset';
      return 'create';
    }
    if (m === 'GET') return 'read';
  }

  const up = (action || '').toUpperCase();
  if (up.includes('DELETE') || up.endsWith('.DELETE')) return 'delete';
  if (up.includes('RESET')) return 'reset';
  if (up.includes('UPDATE') || up.includes('CHANGE') || up.includes('PATCH')) return 'update';
  if (up.includes('CREATE') || up.includes('ADD') || up.includes('INSERT')) return 'create';
  if (up.includes('CANCEL') || up.includes('REPLAY') || up.includes('TOGGLE')) return 'update';
  if (up.includes('CREDIT') || up.includes('RECHARGE')) return 'credit';
  return 'other';
}

/**
 * 将 Mongo lean 文档补全顶层字段，供列表/详情使用。
 */
export function enrichAuditLogRecord(doc: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...doc };
  const detail =
    doc.detail && typeof doc.detail === 'object' && !Array.isArray(doc.detail)
      ? (doc.detail as Record<string, any>)
      : {};

  if (!out.operationKind) {
    out.operationKind = inferAuditOperationKind(detail.method, doc.action);
  }

  let ipChain: string[] = [];
  if (Array.isArray(out.ipChain) && out.ipChain.length > 0) {
    ipChain = out.ipChain.map((x: string) => stripIpv4Mapped(String(x)));
  } else if (Array.isArray(detail.ipChain) && detail.ipChain.length > 0) {
    ipChain = detail.ipChain.map((x: string) => stripIpv4Mapped(String(x)));
  } else if (typeof detail.forwardedForRaw === 'string' && detail.forwardedForRaw.trim()) {
    ipChain = parseXffChain(detail.forwardedForRaw);
  } else if (out.ip && String(out.ip).trim()) {
    ipChain = [stripIpv4Mapped(String(out.ip))];
  } else if (detail.remoteAddress && String(detail.remoteAddress).trim()) {
    ipChain = [stripIpv4Mapped(String(detail.remoteAddress))];
  }
  out.ipChain = ipChain;

  if (!out.forwardedForRaw && typeof detail.forwardedForRaw === 'string') {
    out.forwardedForRaw = detail.forwardedForRaw;
  }

  if (!out.ip || String(out.ip).trim() === '') {
    if (ipChain[0]) out.ip = ipChain[0];
    else if (detail.remoteAddress) out.ip = stripIpv4Mapped(String(detail.remoteAddress));
  }

  return out;
}

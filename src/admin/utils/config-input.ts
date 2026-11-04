import { BadRequestException, ConflictException } from '@nestjs/common';

export function expectedRevision(current: any, expected: unknown) {
  if (expected === undefined) return;
  if (!Number.isSafeInteger(expected) || (expected as number) < 0) throw new BadRequestException('expected_revision 必须为非负安全整数');
  if ((current?.revision || 0) !== expected) throw new ConflictException('配置已被修改，请刷新后重试');
}
export function revisionMatch(current: any) {
  return current?.revision ? { revision: current.revision } : { $or: [{ revision: 0 }, { revision: { $exists: false } }] };
}
export function validateConfigInput(body: any) {
  const numeric: Record<string, [number, number]> = { weight: [0.000001, 1000000], daily_cost_limit: [0, 1e12], monthly_cost_limit: [0, 1e12] };
  for (const [key, [min, max]] of Object.entries(numeric)) if (body[key] !== undefined && (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < min || body[key] > max)) throw new BadRequestException(`${key} 必须为 ${min} 至 ${max} 的有限数字`);
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new BadRequestException('enabled 必须为布尔值');
  if (body.base_url !== undefined && body.base_url !== '') {
    try { const url = new URL(body.base_url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(); }
    catch { throw new BadRequestException('Base URL 需要为 HTTP(S) 地址，不含凭证、查询参数或片段；留空恢复默认地址'); }
  }
  for (const section of ['limits', 'poll_limits']) if (body[section] !== undefined) {
    if (!body[section] || typeof body[section] !== 'object' || Array.isArray(body[section])) throw new BadRequestException(`${section} 必须为对象`);
    for (const [key, value] of Object.entries(body[section])) if (!['max_concurrent', 'max_per_second', 'max_per_minute'].includes(key) || typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1000000 || (key === 'max_concurrent' && !Number.isInteger(value))) throw new BadRequestException(`${section}.${key} 必须为正数，并发需要整数，最大 1000000`);
  }
}

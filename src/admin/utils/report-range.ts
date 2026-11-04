import { BadRequestException } from '@nestjs/common';

/** Reporting dates are explicit UTC calendar dates; never depend on host TZ. */
export function reportRange(from?: string, to?: string) {
  const end = to || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(Date.parse(end)) || new Date(end).toISOString().slice(0, 10) !== end) throw new BadRequestException('日期必须为有效的 YYYY-MM-DD（UTC）');
  const start = from || new Date(Date.parse(`${end}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  for (const value of [start, end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('日期必须为有效的 YYYY-MM-DD（UTC）');
    }
  }
  if (start > end || Date.parse(end) - Date.parse(start) > 366 * 86400000) throw new BadRequestException('日期范围应为 0 至 366 天');
  return { start, end, from: new Date(`${start}T00:00:00Z`), until: new Date(Date.parse(`${end}T00:00:00Z`) + 86400000) };
}

/**
 * PROCESS_TYPE 解析与校验。
 *
 * - 生产环境（NODE_ENV=production）仅允许：api | worker | scheduler | admin-server
 * - 非生产环境额外允许：monolith（单进程加载全模块，便于本地联调）
 */

export const PRODUCTION_PROCESS_TYPES = ['api', 'worker', 'scheduler', 'admin-server'] as const;
export type ProductionProcessType = (typeof PRODUCTION_PROCESS_TYPES)[number];

export const MONOLITH_PROCESS_TYPE = 'monolith' as const;

export type ResolvedProcessType = ProductionProcessType | typeof MONOLITH_PROCESS_TYPE;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * 解析并校验 PROCESS_TYPE。非法值将抛错，避免误走「全模块」或未知组合。
 */
export function resolveProcessType(raw?: string): ResolvedProcessType {
  const trimmed = (raw ?? '').trim();
  const value = trimmed === '' ? 'api' : trimmed;

  if ((PRODUCTION_PROCESS_TYPES as readonly string[]).includes(value)) {
    return value as ProductionProcessType;
  }

  if (value === MONOLITH_PROCESS_TYPE) {
    if (isProduction()) {
      throw new Error(
        `PROCESS_TYPE="${MONOLITH_PROCESS_TYPE}" is not allowed when NODE_ENV=production (prevents accidental full-stack / duplicate queue consumers).`,
      );
    }
    return MONOLITH_PROCESS_TYPE;
  }

  const allowed = isProduction()
    ? PRODUCTION_PROCESS_TYPES.join(', ')
    : `${PRODUCTION_PROCESS_TYPES.join(', ')}, ${MONOLITH_PROCESS_TYPE}`;

  throw new Error(
    `Invalid PROCESS_TYPE="${raw ?? ''}". Must be one of: ${allowed}`,
  );
}

/** API 对外展示的金额 / credits 小数位（与控制台展示一致） */
export const API_MONEY_DECIMALS = 2;

export function roundMoney(n: number, decimals: number = API_MONEY_DECIMALS): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

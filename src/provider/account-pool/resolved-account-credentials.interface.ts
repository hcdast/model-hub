/**
 * 从 AccountPoolEntry 解析出的认证信息，传递给 Adapter 的 customize 回调。
 * 密钥的唯一来源，替代原先分散在 ResolvedProviderRuntime 中的 apiKey / bizId 等字段。
 */
export interface ResolvedAccountCredentials {
  /** 厂商 API 密钥 */
  apiKey: string;

  /** 扩展认证字段，支持 tencent-cloud 等需要多个认证参数的厂商 */
  extraCredentials: Record<string, unknown>;

  /** 账号池条目的唯一标识（MongoDB _id） */
  accountId: string;

  /** 账号别名，便于日志和管理识别 */
  accountAlias: string;
}

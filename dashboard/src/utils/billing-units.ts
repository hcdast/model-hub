interface UsageBilling {
  usageType?: string;
  usageMeasure?: string;
}

/** Use the recorded measure, never infer character billing from a model name. */
export function billingUsageSuffix(billing: UsageBilling, featureType?: string): string {
  if (billing.usageType === 'count' && billing.usageMeasure === 'characters') return '字符';
  if (billing.usageType === 'duration') return '秒';
  if (billing.usageType === 'token') return 'Token';
  if (billing.usageType === 'count') {
    return ['image_generate', 'text_to_image', 'image_to_image', 'textToImage', 'imageToImage'].includes(featureType || '') ? '张' : '次';
  }
  return '';
}

export function formatBillingUsageValue(value: unknown, billing: UsageBilling, featureType?: string): string {
  if (value === undefined || value === null) return '—';
  const suffix = billingUsageSuffix(billing, featureType);
  return suffix ? `${value} ${suffix}` : String(value);
}

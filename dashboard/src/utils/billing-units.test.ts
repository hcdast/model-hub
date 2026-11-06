import { describe, expect, it } from 'vitest';
import { billingUsageSuffix, formatBillingUsageValue } from './billing-units';
import { calcSuccessRate } from './trend-chart-helpers';

describe('Recorded billing units', () => {
  it('distinguishes characters, image counts, general counts, duration and tokens', () => {
    expect(formatBillingUsageValue(22, { usageType: 'count', usageMeasure: 'characters' }, 'tts')).toBe('22 字符');
    expect(billingUsageSuffix({ usageType: 'count' }, 'tts')).toBe('次');
    expect(billingUsageSuffix({ usageType: 'count' }, 'image_generate')).toBe('张');
    expect(billingUsageSuffix({ usageType: 'duration' }, 'tts')).toBe('秒');
    expect(billingUsageSuffix({ usageType: 'token' })).toBe('Token');
    expect(formatBillingUsageValue(undefined, { usageType: 'count' })).toBe('—');
  });
  it('handles legacy trends without optional terminal counts without NaN', () => {
    expect(calcSuccessRate({ successCount: 3, failedCount: 1 } as any)).toBe(75);
    expect(calcSuccessRate({ successCount: 0, failedCount: 0 } as any)).toBe(0);
    expect(calcSuccessRate({ successCount: 3, failedCount: 1, timeoutCount: 1, cancelledCount: 1 } as any)).toBe(50);
  });
});

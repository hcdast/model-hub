import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateModelContract } from './model-contract';
import { validateParams } from './param-validator';
import { estimateModelPrice, estimatePublicModelPrice } from './model-pricing';
const contract = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/seedance25-maas.contract.json'), 'utf8'));
const baseline = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/seedance25-maas-fat-baseline.json'), 'utf8'));

describe('Seedance 2.5 MaaS contract', () => {
  it('is valid and disabled, with no invented prices', () => {
    expect(validateModelContract(contract)).toEqual([]);
    expect(contract.provider).toBe('akool-maas'); expect(contract.disabled).toBe(true);
    expect(contract.unit_price_map).toBeUndefined();
  });
  it('applies documented defaults and accepts media references', () => {
    const result = validateParams(contract.examples[0].input, contract.params, contract.params_rules);
    expect(result.valid).toBe(true); expect(result.sanitized.generate_audio).toBe(true);
    expect(result.sanitized.omni_reference_task_type).toBeUndefined();
  });
  it.each([{ omni_reference_task_type: 'edit' }, { omni_reference_task_type: 'extend' }, { duration: 5.5 }, { images: Array(31).fill('https://example.com/i.png') }])('rejects invalid input %j', input => {
    expect(validateParams(input, contract.params, contract.params_rules).valid).toBe(false);
  });
  it('validates editing and freezes positive usage for adaptive duration', () => {
    const input = { videos: ['https://example.com/v.mp4'], omni_reference_task_type: 'edit', ratio: 'adaptive', duration: -1 };
    const result = validateParams(input, contract.params, contract.params_rules);
    expect(result.valid).toBe(true);
    expect(estimateModelPrice({ ...contract, unit_price_map: { default: { unit_credit: 3 }, '720p:video': { unit_credit: 4 } } }, result.sanitized)).toMatchObject({ estimatedUsage: 30, estimatedCost: 120 });
  });
  it('keeps the locally configured baseline disabled with valid conditional prices', () => {
    expect(validateModelContract(baseline)).toEqual([]);
    expect(baseline.disabled).toBe(true);
    expect(baseline.params.resolution.enum).toEqual(['480p', '720p']);
    for (const example of baseline.examples) {
      expect(validateParams(example.input, baseline.params, baseline.params_rules).valid).toBe(true);
      if (example.output) expect(validateParams({ result: example.output }, { result: baseline.output_schema }).valid).toBe(true);
    }
  });
  it.each([
    ['480p', undefined, 4], ['480p', [], 4], ['480p', ['https://example.com/v.mp4'], 2.4],
    ['720p', undefined, 9.1], ['720p', [], 9.1], ['720p', ['https://example.com/v.mp4'], 5.4],
  ])('uses the same public and server price for %s and videos=%j', (resolution, videos, unitPrice) => {
    const input = { resolution, videos, duration: 5 };
    const server = estimateModelPrice(baseline, input);
    const pricing = { ...baseline.pricing, currency: 'credit', tiers: Object.fromEntries(Object.entries(baseline.unit_price_map).map(([key, value]: [string, any]) => [key, value.unit_credit])) };
    expect(server).toMatchObject({ unitPrice, estimatedCost: (unitPrice as number) * 5 });
    expect(estimatePublicModelPrice(baseline.model_type, pricing, input)).toMatchObject({ unitPrice: server.unitPrice, estimatedCost: server.estimatedCost });
  });
  it('rejects a missing conditional price instead of charging the default tier', () => {
    const invalid = { ...baseline, unit_price_map: { ...baseline.unit_price_map, '720p:video': undefined } };
    expect(validateModelContract(invalid)).toContain('pricing.tier_rules 缺少有效价格档位 720p:video');
    expect(() => estimateModelPrice(invalid, { resolution: '720p', videos: ['https://example.com/v.mp4'], duration: 5 })).toThrow('Missing billing price tier');
  });
});

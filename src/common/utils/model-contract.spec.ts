import { validateParams } from './param-validator';
import { publicDefinitions, publicValue, validateModelContract } from './model-contract';
import { validateParamDefinitions } from './param-definition-validator';
import { estimateModelPrice } from './model-pricing';
import type { ParamDefinitions } from '../interfaces/param-definition.interface';
import { modelOutputPreview } from '../../../portal/src/utils/model-output-preview';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Model contract v2', () => {
  const params: ParamDefinitions = {
    images: { required: false, type: 'array', maxItems: 1, items: { type: 'string', required: true, format: 'uri' }, media: { kind: 'image' } },
    duration: { required: false, type: 'integer', min: -1, max: 30, default: -1 },
    settings: { required: false, type: 'object', properties: { strength: { type: 'number', required: true, min: 0, max: 1 } } },
    resolution: { required: false, type: 'string', enum: ['720p', '1080p'], enumDependsOn: { param: 'ratio', map: { square: ['720p'], wide: ['720p', '1080p'] } } },
    ratio: { required: false, type: 'string', default: 'square' },
  };
  it('checks integer, nested values, array bounds and media URL format', () => {
    for (const input of [{ duration: 4.5 }, { duration: Infinity }, { settings: { strength: 2 } }, { images: ['https://example.com/a', 'https://example.com/b'] }, { images: ['file:///test'] }]) {
      expect(validateParams(input, params).valid).toBe(false);
    }
    expect(validateParams({ images: ['https://example.com/a'], settings: { strength: 0, ignored: 1 } }, params)).toMatchObject({ valid: true, sanitized: { duration: -1, ratio: 'square', settings: { strength: 0 } } });
  });
  it('enforces dependent enums after defaults irrespective of definition order', () => {
    expect(validateParams({ resolution: '1080p' }, params).valid).toBe(false);
    expect(validateParams({ ratio: 'wide', resolution: '1080p' }, params).valid).toBe(true);
  });
  it('enforces conditional required/value rules and total media counts', () => {
    const rules = [{ when: [{ field: 'ratio', operator: 'eq' as const, value: 'wide' }], require: ['images'], values: { duration: [-1] } }];
    expect(validateParams({ ratio: 'wide' }, params, rules).valid).toBe(false);
    expect(validateParams({ ratio: 'wide', images: ['https://example.com/a'] }, params, rules).valid).toBe(true);
    expect(validateParams({ images: ['https://example.com/a'] }, params, [{ when: [], maxTotalItems: { fields: ['images'], max: 0 } }]).valid).toBe(false);
  });
  it('rejects malformed schemas, defaults and references at configuration time', () => {
    expect(validateParamDefinitions(params).valid).toBe(true);
    expect(validateParamDefinitions({ n: { type: 'integer', required: false, default: 1.5 } }).valid).toBe(false);
    expect(validateModelContract({ params, params_rules: [{ when: [], require: ['missing'] }] }).length).toBeGreaterThan(0);
    expect(validateModelContract({ params, pricing: { auto_prelock_units: 0 } }).length).toBeGreaterThan(0);
    for (const tier_rules of [null, {}, [{ when: [{ field: 'missing', operator: 'present' }], tier: 'video' }], [{ when: [], tier: '' }]]) {
      expect(validateModelContract({ params, pricing: { tier_rules: tier_rules as any } }).length).toBeGreaterThan(0);
    }
    expect(validateParamDefinitions({ media: { type: 'array', required: false, media: { kind: 'image' }, items: { type: 'object', required: false } } }).valid).toBe(false);
  });
  it('does not publish hidden nested definitions, mapping or default values', () => {
    const definitions: ParamDefinitions = { settings: { required: false, type: 'object', default: { public: 'yes', secret: 'no' }, properties: {
      public: { required: false, type: 'string', third_party_field: 'internal_field' }, secret: { required: false, type: 'string', hide: true },
    } } };
    const visible = publicDefinitions(definitions);
    expect(JSON.stringify(visible)).not.toMatch(/secret|internal_field|hide/);
    expect(publicValue({ settings: { public: 'ok', secret: 'hidden' }, ignored: true }, { type: 'object', required: false, properties: visible })).toEqual({ settings: { public: 'ok' } });
  });
  it('uses the selected configuration, tier and positive auto-duration estimate', () => {
    const config = { model_id: 'same-model', model_type: 'referenceToVideo', unit_price_map: { default: { unit_credit: 1 }, '1080p': { unit_credit: 3 } }, pricing: { tier_param: 'resolution', auto_prelock_units: 30 } };
    expect(estimateModelPrice(config, { resolution: '1080p', duration: -1 })).toMatchObject({ unitPrice: 3, estimatedUsage: 30, estimatedCost: 90 });
    expect(estimateModelPrice(config, { resolution: '720p', duration: 5 }).estimatedCost).toBe(5);
    expect(() => estimateModelPrice(config, { duration: 0 })).toThrow();
    expect(() => estimateModelPrice(config, { duration: NaN })).toThrow();
  });
  it('validates the disabled import template and rejects malformed enum maps/groups', () => {
    const template = JSON.parse(readFileSync(join(__dirname, '../fixtures/model-contract-v2.example.json'), 'utf8'));
    expect(template.disabled).toBe(true);
    expect(validateModelContract(template)).toEqual([]);
    expect(validateParamDefinitions({ a: { type: 'string', required: false }, b: { type: 'string', required: false, enumDependsOn: { param: 'a', map: { x: 'bad' } } } }).valid).toBe(false);
    expect(validateModelContract({ params, ui_schema: { groups: 'invalid' as any } }).length).toBeGreaterThan(0);
  });
  it('previews declared nested output media without guessing provider fields', () => {
    const schema: any = { type: 'object', required: false, properties: { clips: { type: 'array', required: false, items: { type: 'string', required: true, media: { kind: 'video' } } } } };
    expect(modelOutputPreview({ clips: ['https://example.com/clip'], other: 'private' }, schema)).toEqual({ video: ['https://example.com/clip'] });
    expect(modelOutputPreview({ arbitrary: 'https://example.com/a' })).toEqual({ arbitrary: 'https://example.com/a' });
  });
});

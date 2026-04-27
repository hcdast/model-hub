import * as fc from 'fast-check';
import { generateParamDoc } from './param-doc-generator';
import {
  ParamType,
  ParamDefinition,
  ParamConfigItem,
} from '../interfaces/param-definition.interface';
import { ModelConfig } from '../../database/schemas/model-config.schema';

// ─── Generators ───

const paramType: fc.Arbitrary<ParamType> = fc.constantFrom(
  'string',
  'number',
  'boolean',
  'array',
);

const fieldName = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,9}$/)
  .filter((s) => s.length > 0);

/** Generate a ParamConfigItem */
const arbConfigItem: fc.Arbitrary<ParamConfigItem> = fc.record({
  value: fc.oneof(fc.string({ minLength: 1, maxLength: 10 }), fc.integer({ min: 0, max: 100 })),
  label: fc.string({ minLength: 1, maxLength: 20 }),
});

/** Generate a ParamDefinition with controlled hide and configs */
function arbParamDef(opts?: {
  hide?: boolean;
  withConfigs?: boolean;
}): fc.Arbitrary<ParamDefinition> {
  return fc.record({
    required: fc.boolean(),
    type: paramType,
    description: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    default: fc.option(fc.oneof(fc.string({ minLength: 1, maxLength: 10 }), fc.integer()), { nil: undefined }),
    enum: fc.option(
      fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 4 }),
      { nil: undefined },
    ),
    min: fc.option(fc.integer({ min: 0, max: 50 }), { nil: undefined }),
    max: fc.option(fc.integer({ min: 51, max: 100 }), { nil: undefined }),
    hide: fc.constant(opts?.hide ?? false),
    configs: opts?.withConfigs
      ? fc.array(arbConfigItem, { minLength: 1, maxLength: 3 }).map((c) => c as ParamConfigItem[])
      : fc.constant(undefined as ParamConfigItem[] | undefined),
  }) as fc.Arbitrary<ParamDefinition>;
}

/** Generate a minimal ModelConfig-like object with params */
function arbModelConfig(
  params: Record<string, ParamDefinition>,
): ModelConfig {
  const cfg = new ModelConfig();
  cfg.model_name = 'test/model';
  cfg.model_type = 40001;
  cfg.provider = 'TestProvider';
  cfg.label = 'Test Model';
  cfg.params = params as any;
  return cfg;
}

/**
 * Generate a params record with a mix of visible, hidden, and configs-bearing definitions.
 * Returns the record plus metadata about which keys are visible/hidden/have configs.
 */
const arbParamsWithMeta = fc
  .tuple(
    // visible params (no hide, no configs)
    fc.array(fc.tuple(fieldName, arbParamDef({ hide: false, withConfigs: false })), {
      minLength: 1,
      maxLength: 4,
    }),
    // hidden params
    fc.array(fc.tuple(fieldName, arbParamDef({ hide: true, withConfigs: false })), {
      minLength: 0,
      maxLength: 2,
    }),
    // visible params with configs
    fc.array(fc.tuple(fieldName, arbParamDef({ hide: false, withConfigs: true })), {
      minLength: 0,
      maxLength: 2,
    }),
  )
  .map(([visible, hidden, withConfigs]) => {
    const params: Record<string, ParamDefinition> = {};
    const visibleKeys: string[] = [];
    const hiddenKeys: string[] = [];
    const configKeys: string[] = [];
    const usedKeys = new Set<string>();

    for (const [key, def] of visible) {
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      params[key] = def;
      visibleKeys.push(key);
    }
    for (const [key, def] of hidden) {
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      params[key] = def;
      hiddenKeys.push(key);
    }
    for (const [key, def] of withConfigs) {
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      params[key] = def;
      visibleKeys.push(key);
      configKeys.push(key);
    }

    return { params, visibleKeys, hiddenKeys, configKeys };
  })
  .filter((m) => m.visibleKeys.length > 0);

// ─── Property 9: 文档生成完整性 ───

/**
 * Feature: unified-model-params, Property 9: 文档生成完整性
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 *
 * For any ModelConfig, generateParamDoc should:
 * (a) include all params where hide !== true
 * (b) exclude all params where hide === true
 * (c) each param item contains name, type, required
 * (d) params with configs include configs info
 */
describe('Property 9: 文档生成完整性', () => {
  it('should include visible params, exclude hidden, contain required fields, and preserve configs', () => {
    fc.assert(
      fc.property(arbParamsWithMeta, ({ params, visibleKeys, hiddenKeys, configKeys }) => {
        const cfg = arbModelConfig(params);
        const doc = generateParamDoc(cfg);

        const docNames = doc.params.map((p) => p.name);

        // (a) All visible keys are present
        for (const key of visibleKeys) {
          expect(docNames).toContain(key);
        }

        // (b) No hidden keys are present
        for (const key of hiddenKeys) {
          expect(docNames).not.toContain(key);
        }

        // (c) Every param item has name, type, required
        for (const item of doc.params) {
          expect(typeof item.name).toBe('string');
          expect(item.name.length).toBeGreaterThan(0);
          expect(['string', 'number', 'boolean', 'array']).toContain(item.type);
          expect(typeof item.required).toBe('boolean');
        }

        // (d) Params with configs have configs in the doc
        for (const key of configKeys) {
          const item = doc.params.find((p) => p.name === key);
          expect(item).toBeDefined();
          expect(item!.configs).toBeDefined();
          expect(Array.isArray(item!.configs)).toBe(true);
          expect(item!.configs!.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

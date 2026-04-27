import * as fc from 'fast-check';
import { validateParams } from './param-validator';
import {
  ParamDefinitions,
  ParamDefinition,
  ParamType,
} from '../interfaces/param-definition.interface';

// ─── Generators ───

const paramType: fc.Arbitrary<ParamType> = fc.constantFrom(
  'string',
  'number',
  'boolean',
  'array',
);

/** Generate a value that matches the given ParamType */
function valueForType(type: ParamType): fc.Arbitrary<any> {
  switch (type) {
    case 'string':
      return fc.string({ minLength: 1, maxLength: 20 });
    case 'number':
      return fc.double({ min: -1e6, max: 1e6, noNaN: true });
    case 'boolean':
      return fc.boolean();
    case 'array':
      return fc.array(fc.string(), { minLength: 0, maxLength: 5 });
  }
}

/** Generate a value whose type does NOT match the given ParamType */
function mismatchedValueForType(type: ParamType): fc.Arbitrary<any> {
  switch (type) {
    case 'string':
      return fc.oneof(
        fc.double({ noNaN: true }),
        fc.boolean(),
        fc.array(fc.integer()),
      );
    case 'number':
      return fc.oneof(fc.string(), fc.boolean(), fc.array(fc.integer()));
    case 'boolean':
      return fc.oneof(
        fc.string(),
        fc.double({ noNaN: true }),
        fc.array(fc.integer()),
      );
    case 'array':
      return fc.oneof(
        fc.string(),
        fc.double({ noNaN: true }),
        fc.boolean(),
      );
  }
}

/** Generate a simple, valid ParamDefinition */
function arbParamDefinition(overrides?: Partial<ParamDefinition>): fc.Arbitrary<ParamDefinition> {
  return paramType.map((t) => ({
    required: false,
    type: t,
    ...overrides,
  }));
}

/** Generate a field name (simple alphanumeric) */
const fieldName = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,9}$/)
  .filter((s) => s.length > 0);


// ─── Property 1: 缺少必填参数时校验失败 ───

/**
 * Feature: unified-model-params, Property 1: 缺少必填参数时校验失败
 * Validates: Requirements 2.2
 *
 * For any ParamDefinitions and input, if the input is missing any required
 * parameter, validation should fail and errors should mention the missing field.
 */
describe('Property 1: 缺少必填参数时校验失败', () => {
  it('should fail when a required param is missing from input', () => {
    fc.assert(
      fc.property(
        fieldName,
        paramType,
        (name, type) => {
          const definitions: ParamDefinitions = {
            [name]: { required: true, type },
          };
          const result = validateParams({}, definitions);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.field === name)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 2: 类型不匹配时校验失败 ───

/**
 * Feature: unified-model-params, Property 2: 类型不匹配时校验失败
 * Validates: Requirements 2.3
 *
 * For any ParamDefinition type and a mismatched value, validation should fail
 * with an error mentioning the field name and expected type.
 */
describe('Property 2: 类型不匹配时校验失败', () => {
  it('should fail when value type does not match definition type', () => {
    fc.assert(
      fc.property(
        fieldName,
        paramType,
        (name, type) => {
          return fc.assert(
            fc.property(mismatchedValueForType(type), (badValue) => {
              const definitions: ParamDefinitions = {
                [name]: { required: true, type },
              };
              const result = validateParams({ [name]: badValue }, definitions);
              expect(result.valid).toBe(false);
              const err = result.errors.find((e) => e.field === name);
              expect(err).toBeDefined();
              expect(err!.expected).toBe(type);
            }),
            { numRuns: 10 },
          );
        },
      ),
      { numRuns: 20 },
    );
  });
});


// ─── Property 3: 枚举值校验 ───

/**
 * Feature: unified-model-params, Property 3: 枚举值校验
 * Validates: Requirements 2.4
 *
 * For any ParamDefinition with an enum constraint, a value NOT in the enum
 * should fail validation; a value IN the enum should pass the enum check.
 */
describe('Property 3: 枚举值校验', () => {
  it('should fail when value is not in enum list', () => {
    fc.assert(
      fc.property(
        fieldName,
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 2, maxLength: 6 }),
        (name, enumValues) => {
          const unique = [...new Set(enumValues)];
          if (unique.length < 2) return; // need at least 2 unique values

          const definitions: ParamDefinitions = {
            [name]: { required: true, type: 'string', enum: unique },
          };

          // Pick a value guaranteed not in the enum
          const badValue = unique.join('_INVALID_');
          const result = validateParams({ [name]: badValue }, definitions);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.field === name)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should pass when value is in enum list', () => {
    fc.assert(
      fc.property(
        fieldName,
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 6 }),
        fc.nat(),
        (name, enumValues, idx) => {
          const unique = [...new Set(enumValues)];
          if (unique.length === 0) return;

          const picked = unique[idx % unique.length];
          const definitions: ParamDefinitions = {
            [name]: { required: true, type: 'string', enum: unique },
          };
          const result = validateParams({ [name]: picked }, definitions);
          // No enum-related error for this field
          const enumErr = result.errors.find(
            (e) => e.field === name && Array.isArray(e.expected),
          );
          expect(enumErr).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 4: 数值范围校验 ───

/**
 * Feature: unified-model-params, Property 4: 数值范围校验
 * Validates: Requirements 2.5
 *
 * For any number ParamDefinition with min/max, a value outside the range
 * should fail; a value inside should pass the range check.
 */
describe('Property 4: 数值范围校验', () => {
  it('should fail when number is below min', () => {
    fc.assert(
      fc.property(
        fieldName,
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        (name, min, offset) => {
          const belowMin = min - offset;
          const definitions: ParamDefinitions = {
            [name]: { required: true, type: 'number', min },
          };
          const result = validateParams({ [name]: belowMin }, definitions);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.field === name)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should fail when number is above max', () => {
    fc.assert(
      fc.property(
        fieldName,
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        (name, max, offset) => {
          const aboveMax = max + offset;
          const definitions: ParamDefinitions = {
            [name]: { required: true, type: 'number', max },
          };
          const result = validateParams({ [name]: aboveMax }, definitions);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.field === name)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should pass when number is within range', () => {
    fc.assert(
      fc.property(
        fieldName,
        fc.double({ min: -1e4, max: 0, noNaN: true }),
        fc.double({ min: 0, max: 1e4, noNaN: true }),
        (name, min, max) => {
          if (min > max) [min, max] = [max, min]; // ensure min <= max
          const value = (min + max) / 2;
          const definitions: ParamDefinitions = {
            [name]: { required: true, type: 'number', min, max },
          };
          const result = validateParams({ [name]: value }, definitions);
          const rangeErr = result.errors.find(
            (e) => e.field === name && e.expected?.min !== undefined,
          );
          expect(rangeErr).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 5: 默认值填充 ───

/**
 * Feature: unified-model-params, Property 5: 默认值填充
 * Validates: Requirements 2.6
 *
 * For any non-required ParamDefinition with a default value, if the input
 * does not provide that param, the sanitized result should contain the default.
 */
describe('Property 5: 默认值填充', () => {
  it('should fill default value for missing optional params', () => {
    fc.assert(
      fc.property(
        fieldName,
        paramType,
        (name, type) => {
          const defaultVal = type === 'string' ? 'default_val'
            : type === 'number' ? 42
            : type === 'boolean' ? true
            : ['a'];

          const definitions: ParamDefinitions = {
            [name]: { required: false, type, default: defaultVal },
          };
          const result = validateParams({}, definitions);
          expect(result.valid).toBe(true);
          expect(result.sanitized[name]).toEqual(defaultVal);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 6: 未定义参数过滤 ───

/**
 * Feature: unified-model-params, Property 6: 未定义参数过滤
 * Validates: Requirements 2.7
 *
 * For any input and ParamDefinitions, the sanitized result should never
 * contain keys that are not defined in ParamDefinitions.
 */
describe('Property 6: 未定义参数过滤', () => {
  it('should exclude params not defined in definitions', () => {
    fc.assert(
      fc.property(
        fieldName,
        fieldName,
        fc.string(),
        (definedName, extraName, extraValue) => {
          // Ensure the extra name is different from the defined name
          if (definedName === extraName) return;

          const definitions: ParamDefinitions = {
            [definedName]: { required: false, type: 'string', default: 'x' },
          };
          const input = {
            [definedName]: 'hello',
            [extraName]: extraValue,
          };
          const result = validateParams(input, definitions);
          expect(result.valid).toBe(true);
          expect(Object.keys(result.sanitized)).not.toContain(extraName);
          expect(Object.keys(result.sanitized)).toContain(definedName);
        },
      ),
      { numRuns: 100 },
    );
  });
});

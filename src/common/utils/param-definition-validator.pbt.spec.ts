import * as fc from 'fast-check';
import { validateParamDefinitions } from './param-definition-validator';
import { ParamType } from '../interfaces/param-definition.interface';

// ─── Generators ───

const validType: fc.Arbitrary<ParamType> = fc.constantFrom(
  'string',
  'number',
  'boolean',
  'array',
);

const invalidType: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter((s) => !['string', 'number', 'boolean', 'array'].includes(s));

const paramName = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,9}$/)
  .filter((s) => s.length > 0);

// ─── Property 10: 参数定义校验 ───

/**
 * Feature: unified-model-params, Property 10: 参数定义校验
 * Validates: Requirements 5.2, 5.3, 5.4
 *
 * For any invalid ParamDefinition (type not in allowed list, or enum exists
 * but default not in enum, or min > max), validateParamDefinitions should
 * return valid: false with corresponding error info.
 */
describe('Property 10: 参数定义校验', () => {
  it('should fail when type is not in allowed list', () => {
    fc.assert(
      fc.property(paramName, invalidType, (name, badType) => {
        const params = {
          [name]: { required: true, type: badType },
        };
        const result = validateParamDefinitions(params);
        expect(result.valid).toBe(false);
        expect(
          result.errors.some(
            (e) => e.paramName === name && e.field === 'type',
          ),
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should fail when default is not in enum', () => {
    fc.assert(
      fc.property(
        paramName,
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), {
          minLength: 2,
          maxLength: 6,
        }),
        (name, enumValues) => {
          const unique = [...new Set(enumValues)];
          if (unique.length < 2) return;

          // default that is guaranteed not in enum
          const badDefault = unique.join('_NOPE_');

          const params = {
            [name]: {
              required: false,
              type: 'string' as ParamType,
              enum: unique,
              default: badDefault,
            },
          };
          const result = validateParamDefinitions(params);
          expect(result.valid).toBe(false);
          expect(
            result.errors.some(
              (e) => e.paramName === name && e.field === 'default',
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should fail when min > max', () => {
    fc.assert(
      fc.property(
        paramName,
        fc.double({ min: 0.01, max: 1e4, noNaN: true }),
        fc.double({ min: 0.01, max: 1e4, noNaN: true }),
        (name, a, b) => {
          const min = Math.max(a, b);
          const max = Math.min(a, b);
          if (min <= max) return; // skip when they happen to be equal

          const params = {
            [name]: { required: false, type: 'number' as ParamType, min, max },
          };
          const result = validateParamDefinitions(params);
          expect(result.valid).toBe(false);
          expect(
            result.errors.some(
              (e) => e.paramName === name && e.field === 'min/max',
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should pass for valid definitions', () => {
    fc.assert(
      fc.property(
        paramName,
        validType,
        fc.double({ min: -1e3, max: 0, noNaN: true }),
        fc.double({ min: 0, max: 1e3, noNaN: true }),
        (name, type, minVal, maxVal) => {
          const params = {
            [name]: {
              required: true,
              type,
              ...(type === 'number' ? { min: minVal, max: maxVal } : {}),
            },
          };
          const result = validateParamDefinitions(params);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

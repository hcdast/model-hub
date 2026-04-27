import * as fc from 'fast-check';
import { transformParams, reverseTransformParams } from './param-transformer';
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

/** Generate a simple field name */
const fieldName = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,9}$/)
  .filter((s) => s.length > 0);

/** Generate a third_party_field name (different namespace to avoid collisions) */
const thirdPartyFieldName = fc
  .stringMatching(/^tp_[a-z][a-z0-9_]{0,7}$/)
  .filter((s) => s.length > 3);

/** Generate a value matching a given ParamType */
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

/**
 * Generate a record of 1-4 ParamDefinitions with unique field names,
 * where some have third_party_field and some don't.
 * Also generates matching input values.
 */
function arbDefinitionsAndInput(): fc.Arbitrary<{
  definitions: ParamDefinitions;
  input: Record<string, any>;
}> {
  return fc
    .array(
      fc.tuple(fieldName, thirdPartyFieldName, paramType, fc.boolean()),
      { minLength: 1, maxLength: 4 },
    )
    .chain((entries) => {
      // Deduplicate field names and third_party_field names
      const seenFields = new Set<string>();
      const seenTpFields = new Set<string>();
      const unique = entries.filter(([f, tp]) => {
        if (seenFields.has(f) || seenTpFields.has(tp) || seenFields.has(tp) || seenTpFields.has(f)) return false;
        seenFields.add(f);
        seenTpFields.add(tp);
        return true;
      });
      if (unique.length === 0) return fc.constant(null as any);

      const definitions: ParamDefinitions = {};
      const valueArbs: fc.Arbitrary<any>[] = [];
      const keys: string[] = [];

      for (const [name, tpField, type, hasThirdParty] of unique) {
        const def: ParamDefinition = { required: false, type };
        if (hasThirdParty) {
          def.third_party_field = tpField;
        }
        definitions[name] = def;
        keys.push(name);
        valueArbs.push(valueForType(type));
      }

      return fc.tuple(...valueArbs).map((values) => {
        const input: Record<string, any> = {};
        keys.forEach((k, i) => {
          input[k] = values[i];
        });
        return { definitions, input };
      });
    })
    .filter((x) => x !== null);
}

// ─── Property 7: 参数转换正确性 ───

/**
 * Feature: unified-model-params, Property 7: 参数转换正确性
 * Validates: Requirements 3.1, 3.2, 3.3
 *
 * For any valid params and ParamDefinitions, after transformParams:
 * (a) params with third_party_field use that as key
 * (b) params without third_party_field keep original key
 * (c) result contains no keys not defined in ParamDefinitions
 */
describe('Property 7: 参数转换正确性', () => {
  it('should correctly transform param keys based on third_party_field', () => {
    fc.assert(
      fc.property(arbDefinitionsAndInput(), ({ definitions, input }) => {
        const { transformed, fieldMapping } = transformParams(input, definitions);

        for (const [name, def] of Object.entries(definitions)) {
          if (!(name in input)) continue;

          if (def.third_party_field) {
            // (a) should use third_party_field as key
            expect(transformed).toHaveProperty(def.third_party_field);
            expect(transformed[def.third_party_field]).toEqual(input[name]);
            expect(fieldMapping[name]).toBe(def.third_party_field);
          } else {
            // (b) should keep original key
            expect(transformed).toHaveProperty(name);
            expect(transformed[name]).toEqual(input[name]);
            expect(fieldMapping[name]).toBe(name);
          }
        }

        // (c) no extra keys in transformed output
        const allowedKeys = new Set(
          Object.entries(definitions).map(([k, d]) => d.third_party_field ?? k),
        );
        for (const key of Object.keys(transformed)) {
          expect(allowedKeys.has(key)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ─── Property 8: 参数转换往返一致性 ───

/**
 * Feature: unified-model-params, Property 8: 参数转换往返一致性
 * Validates: Requirements 3.4
 *
 * For any valid params and ParamDefinitions (where third_party_field values
 * are unique and don't collide with other param names),
 * reverseTransformParams(transformParams(params)) should equal the original params.
 */
describe('Property 8: 参数转换往返一致性', () => {
  it('should round-trip: reverse(transform(params)) === params', () => {
    fc.assert(
      fc.property(arbDefinitionsAndInput(), ({ definitions, input }) => {
        const { transformed } = transformParams(input, definitions);
        const restored = reverseTransformParams(transformed, definitions);

        // The restored params should equal the original input
        // (only for keys that exist in definitions, which is all of them here)
        expect(restored).toEqual(input);
      }),
      { numRuns: 100 },
    );
  });
});

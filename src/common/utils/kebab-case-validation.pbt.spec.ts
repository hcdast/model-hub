import * as fc from 'fast-check';
import { isValidKebabCase } from './kebab-case.util';

/**
 * Feature: global-feature-sync, Property 2: Kebab-case format validation
 * Validates: Requirements 1.3, 9.4
 *
 * For any string, the kebab-case validator should accept strings matching
 * ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ and reject all others.
 */
describe('Property 2: Kebab-case format validation', () => {
  const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

  // Generator for a single kebab segment (lowercase letters and digits, at least 1 char)
  const kebabSegment = fc
    .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 8 })
    .map((chars) => chars.join(''));

  // Generator for valid kebab-case strings
  const validKebabCase = fc
    .array(kebabSegment, { minLength: 1, maxLength: 5 })
    .map((segments) =>
      segments.map((s: string, i: number) => {
        // First segment must start with a letter
        if (i === 0 && /^[0-9]/.test(s)) return 'a' + s;
        return s;
      }).join('-'),
    );

  it('should accept all valid kebab-case strings', () => {
    fc.assert(
      fc.property(validKebabCase, (s) => {
        expect(isValidKebabCase(s)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('should agree with the reference regex for arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(isValidKebabCase(s)).toBe(KEBAB_CASE_REGEX.test(s));
      }),
      { numRuns: 200 },
    );
  });
});

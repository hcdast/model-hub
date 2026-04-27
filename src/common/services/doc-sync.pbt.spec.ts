import * as fc from 'fast-check';
import { DocSyncService } from './doc-sync.service';

// --- Generators ---

/** Generate a valid kebab-case moduleKey */
const kebabSegment = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 1,
    maxLength: 6,
  })
  .map((chars) => chars.join(''));

const validKebabCase = fc
  .array(kebabSegment, { minLength: 1, maxLength: 4 })
  .map((segments) =>
    segments
      .map((s: string, i: number) => (i === 0 && /^[0-9]/.test(s) ? 'a' + s : s))
      .join('-'),
  );

/** Generate arbitrary non-empty content strings (no marker-like substrings) */
const contentArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => !s.includes('<!-- AUTO:') && !s.includes(':START -->') && !s.includes(':END -->'));

// --- Tests ---

/**
 * Feature: global-feature-sync, Property 11: Doc sync marker wrapping
 * Validates: Requirements 6.4
 *
 * For any generated documentation fragment, the output should be wrapped in
 * `<!-- AUTO:{moduleKey}:START -->` and `<!-- AUTO:{moduleKey}:END -->` markers,
 * and replacing content between existing markers with new content should produce
 * valid markdown.
 */
describe('Property 11: Doc sync marker wrapping', () => {
  const service = new DocSyncService();

  it('generateFragment wraps content with correct markers', () => {
    fc.assert(
      fc.property(validKebabCase, contentArb, (moduleKey, content) => {
        const fragment = service.generateFragment(moduleKey, content);

        const startMarker = `<!-- AUTO:${moduleKey}:START -->`;
        const endMarker = `<!-- AUTO:${moduleKey}:END -->`;

        // Fragment starts with start marker and ends with end marker
        expect(fragment.startsWith(startMarker)).toBe(true);
        expect(fragment.endsWith(endMarker)).toBe(true);

        // Content is between the markers
        const inner = fragment.slice(
          startMarker.length + 1, // +1 for newline
          fragment.length - endMarker.length - 1, // -1 for newline
        );
        expect(inner).toBe(content);
      }),
      { numRuns: 100 },
    );
  });

  it('replaceMarkedContent is idempotent — applying same content twice yields same result', () => {
    fc.assert(
      fc.property(validKebabCase, contentArb, contentArb, (moduleKey, existingDoc, newContent) => {
        const once = service.replaceMarkedContent(existingDoc, moduleKey, newContent);
        const twice = service.replaceMarkedContent(once, moduleKey, newContent);

        expect(twice).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it('replaceMarkedContent preserves content outside markers', () => {
    fc.assert(
      fc.property(
        validKebabCase,
        contentArb,
        contentArb,
        contentArb,
        (moduleKey, before, oldContent, newContent) => {
          // Build a document with existing markers
          const startMarker = `<!-- AUTO:${moduleKey}:START -->`;
          const endMarker = `<!-- AUTO:${moduleKey}:END -->`;
          const doc = `${before}\n${startMarker}\n${oldContent}\n${endMarker}`;

          const result = service.replaceMarkedContent(doc, moduleKey, newContent);

          // The before-content should still be present
          expect(result.startsWith(before)).toBe(true);
          // The new content should be wrapped in markers
          expect(result).toContain(startMarker);
          expect(result).toContain(endMarker);
          expect(result).toContain(newContent);
          // The old content should be gone (unless it equals new content)
          if (oldContent !== newContent) {
            expect(result).not.toContain(`\n${oldContent}\n${endMarker}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

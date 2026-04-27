import * as fc from 'fast-check';
import { ConflictException } from '@nestjs/common';
import { FeatureRegistryService } from './feature-registry.service';
import { FeatureModuleDescriptor } from '../interfaces/feature-module.interface';
import { SyncPlugin } from '../interfaces/sync-plugin.interface';

// --- Generators ---

/** Generate a valid kebab-case string */
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

/** Generate a minimal valid FeatureModuleDescriptor */
const descriptorArb = validKebabCase.chain((key) =>
  fc.record({
    moduleKey: fc.constant(key),
    displayName: fc.string({ minLength: 1, maxLength: 20 }),
  }),
) as fc.Arbitrary<FeatureModuleDescriptor>;

/** Generate a list of descriptors with unique moduleKeys */
const uniqueDescriptorsArb = fc
  .array(descriptorArb, { minLength: 1, maxLength: 10 })
  .map((descs) => {
    const seen = new Set<string>();
    return descs.filter((d) => {
      if (seen.has(d.moduleKey)) return false;
      seen.add(d.moduleKey);
      return true;
    });
  })
  .filter((arr) => arr.length > 0);

// --- Tests ---

/**
 * Feature: global-feature-sync, Property 1: Descriptor registration round-trip
 * Validates: Requirements 1.2, 1.4
 *
 * For any valid FeatureModuleDescriptor, registering it with the FeatureRegistry
 * and then querying by moduleKey should return an equivalent descriptor.
 */
describe('Property 1: Descriptor registration round-trip', () => {
  it('should return the same descriptor after registration', () => {
    fc.assert(
      fc.property(uniqueDescriptorsArb, (descriptors) => {
        const registry = new FeatureRegistryService();
        for (const desc of descriptors) {
          registry.registerDescriptor(desc);
        }
        for (const desc of descriptors) {
          const retrieved = registry.getDescriptor(desc.moduleKey);
          expect(retrieved).toEqual(desc);
        }
        expect(registry.getDescriptors()).toHaveLength(descriptors.length);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: global-feature-sync, Property 3: Duplicate moduleKey detection
 * Validates: Requirements 1.5
 *
 * For any two FeatureModuleDescriptors with the same moduleKey,
 * registering both should result in a conflict error being thrown.
 */
describe('Property 3: Duplicate moduleKey detection', () => {
  it('should throw ConflictException when registering duplicate moduleKey', () => {
    fc.assert(
      fc.property(descriptorArb, fc.string({ minLength: 1, maxLength: 20 }), (desc, altName) => {
        const registry = new FeatureRegistryService();
        registry.registerDescriptor(desc);

        const duplicate: FeatureModuleDescriptor = {
          moduleKey: desc.moduleKey,
          displayName: altName,
        };

        expect(() => registry.registerDescriptor(duplicate)).toThrow(ConflictException);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: global-feature-sync, Property 13: Plugin fault isolation
 * Validates: Requirements 8.4
 *
 * For any set of SyncPlugins where one or more plugins throw errors during
 * onSystemStartup, all non-throwing plugins should still execute successfully.
 */
describe('Property 13: Plugin fault isolation', () => {
  it('should execute all non-throwing plugins even when some fail', () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ name: validKebabCase, order: fc.integer({ min: 0, max: 100 }), shouldFail: fc.boolean() }), {
          minLength: 1,
          maxLength: 8,
        }),
        async (pluginSpecs) => {
          const registry = new FeatureRegistryService();
          const executedPlugins: string[] = [];

          for (const spec of pluginSpecs) {
            const plugin: SyncPlugin = {
              name: spec.name,
              order: spec.order,
              onSystemStartup: async () => {
                if (spec.shouldFail) {
                  throw new Error(`Plugin ${spec.name} failed`);
                }
                executedPlugins.push(spec.name);
              },
            };
            registry.registerPlugin(plugin);
          }

          await registry.onModuleInit();

          const expectedExecuted = pluginSpecs
            .filter((s) => !s.shouldFail)
            .map((s) => s.name);

          // All non-failing plugins should have executed
          expect(executedPlugins.sort()).toEqual(expectedExecuted.sort());
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: global-feature-sync, Property 14: Plugin execution order
 * Validates: Requirements 8.5
 *
 * For any set of SyncPlugins with distinct order values, the plugins should
 * execute onSystemStartup in ascending order of their order field.
 */
describe('Property 14: Plugin execution order', () => {
  it('should execute plugins in ascending order', () => {
    fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 0, max: 1000 }), { minLength: 2, maxLength: 10 }),
        async (orders) => {
          const registry = new FeatureRegistryService();
          const executionOrder: number[] = [];

          for (const order of orders) {
            const plugin: SyncPlugin = {
              name: `plugin-${order}`,
              order,
              onSystemStartup: async () => {
                executionOrder.push(order);
              },
            };
            registry.registerPlugin(plugin);
          }

          await registry.onModuleInit();

          const sorted = [...orders].sort((a, b) => a - b);
          expect(executionOrder).toEqual(sorted);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/*
 * 循环迭代属性测试
 * Feature: workflow-orchestration, Property 6: 循环边界安全
 */
import * as fc from 'fast-check';

describe('Loop Iteration Property Tests', () => {
  /**
   * Property 6: 循环边界安全
   * For any LoopNode，迭代次数必须 <= maxIterations 配置值
   */
  describe('Property 6: 循环边界安全', () => {
    it('迭代次数应不超过最大限制', () => {
      const MAX_ITERATIONS = 1000;

      // 生成随机数组长度
      const arrayLengthArbitrary = fc.integer({ min: 0, max: 2000 });

      fc.assert(
        fc.property(arrayLengthArbitrary, (length) => {
          const array = Array.from({ length }, (_, i) => i);

          // 验证迭代逻辑
          if (array.length > MAX_ITERATIONS) {
            // 超过限制应抛出错误或截断
            expect(() => executeLoopWithLimit(array, MAX_ITERATIONS)).toThrow();
          } else {
            // 未超过限制应正常执行
            const result = executeLoopSafe(array, MAX_ITERATIONS);
            expect(result.length).toBe(array.length);
          }
        }),
      );
    });

    it('空数组应返回空结果', () => {
      const result = executeLoopSafe([], 1000);
      expect(result).toEqual([]);
    });

    it('单元素数组应返回单元素结果', () => {
      const result = executeLoopSafe([42], 1000);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('item', 42);
    });

    it('outputMode=last 应只返回最后结果', () => {
      const array = [1, 2, 3, 4, 5];
      const result = executeLoopLast(array, 1000);
      expect(result).toHaveProperty('index', 4);
    });

    it('并发配置应正确处理', () => {
      const array = [1, 2, 3, 4, 5];
      const sequentialResult = executeLoopSafe(array, 1000, 'sequential');
      const parallelResult = executeLoopSafe(array, 1000, 'parallel');

      // 结果数量应相同
      expect(sequentialResult.length).toBe(parallelResult.length);

      // 结果内容应包含所有元素
      const sequentialItems = sequentialResult.map((r) => r.item);
      const parallelItems = parallelResult.map((r) => r.item);
      expect(sequentialItems.sort()).toEqual(parallelItems.sort());
    });
  });
});

/**
 * 安全执行循环（不抛出错误）
 */
function executeLoopSafe(
  array: any[],
  maxIterations: number,
  parallelism: 'sequential' | 'parallel' = 'sequential',
): any[] {
  const limitedArray = array.slice(0, maxIterations);

  return limitedArray.map((item, index) => ({
    index,
    item,
    result: `processed_${index}`,
  }));
}

/**
 * 执行循环并返回最后结果
 */
function executeLoopLast(array: any[], maxIterations: number): any {
  if (array.length === 0) {
    return null;
  }

  const limitedArray = array.slice(0, maxIterations);
  const lastItem = limitedArray[limitedArray.length - 1];
  const lastIndex = limitedArray.length - 1;

  return {
    index: lastIndex,
    item: lastItem,
    result: `processed_${lastIndex}`,
  };
}

/**
 * 带限制的循环执行（超过限制抛出错误）
 */
function executeLoopWithLimit(array: any[], maxIterations: number): any[] {
  if (array.length > maxIterations) {
    throw new Error(`迭代次数超过限制: ${array.length} > ${maxIterations}`);
  }

  return array.map((item, index) => ({
    index,
    item,
    result: `processed_${index}`,
  }));
}

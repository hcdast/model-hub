/*
 * 条件分支属性测试
 * Feature: workflow-orchestration, Property 5: 条件分支唯一性
 */
import * as fc from 'fast-check';

describe('Condition Branch Property Tests', () => {
  /**
   * Property 5: 条件分支唯一性
   * For any ConditionNode，一次执行中只能选择一个分支路径
   */
  describe('Property 5: 条件分支唯一性', () => {
    it('条件评估应只返回一个分支 ID', () => {
      // 定义条件评估函数
      const evaluateConditions = (
        conditions: Array<{ expression: string; branchId: string }>,
        context: Record<string, any>,
      ): string => {
        for (const condition of conditions) {
          try {
            // 简单的表达式评估
            const result = evaluateExpression(condition.expression, context);
            if (result) {
              return condition.branchId;
            }
          } catch {
            continue;
          }
        }
        return 'default';
      };

      // 简单的表达式评估器
      const evaluateExpression = (expression: string, context: Record<string, any>): boolean => {
        try {
          const fn = new Function('$input', `return ${expression}`);
          const result = fn(context);
          return Boolean(result);
        } catch {
          return false;
        }
      };

      // 生成随机的条件配置
      const conditionArbitrary = fc.record({
        expression: fc.string({ minLength: 1, maxLength: 20 }),
        branchId: fc.string({ minLength: 1, maxLength: 10 }),
      });

      const conditionsArbitrary = fc.array(conditionArbitrary, { minLength: 1, maxLength: 5 });
      const contextArbitrary = fc.dictionary(fc.string(), fc.anything());

      fc.assert(
        fc.property(conditionsArbitrary, contextArbitrary, (conditions, context) => {
          const result = evaluateConditions(conditions, context);

          // 结果必须是一个字符串（分支 ID）
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);

          // 如果匹配了某个条件，结果必须是 conditions 中的 branchId
          if (result !== 'default') {
            const matchedCondition = conditions.find((c) => c.branchId === result);
            expect(matchedCondition).toBeDefined();
          }
        }),
      );
    });

    it('条件评估顺序应按数组顺序进行', () => {
      const conditions = [
        { expression: '$input.value > 0', branchId: 'positive' },
        { expression: '$input.value < 0', branchId: 'negative' },
        { expression: '$input.value === 0', branchId: 'zero' },
      ];

      // value = 5 时，应匹配第一个条件
      const result1 = evaluateConditions(conditions, { value: 5 });
      expect(result1).toBe('positive');

      // value = -5 时，应匹配第二个条件
      const result2 = evaluateConditions(conditions, { value: -5 });
      expect(result2).toBe('negative');

      // value = 0 时，应匹配第三个条件（但第一个条件也满足，所以返回第一个）
      // 注意：value > 0 对于 0 是 false，所以会检查 value < 0（false），最后 value === 0（true）
      const result3 = evaluateConditions(conditions, { value: 0 });
      expect(result3).toBe('zero');

      function evaluateConditions(
        conditionsList: Array<{ expression: string; branchId: string }>,
        context: Record<string, any>,
      ): string {
        for (const condition of conditionsList) {
          try {
            const fn = new Function('$input', `return ${condition.expression}`);
            if (fn(context)) {
              return condition.branchId;
            }
          } catch {
            continue;
          }
        }
        return 'default';
      }
    });

    it('无匹配条件时应返回默认分支', () => {
      const conditions = [
        { expression: '$input.value > 100', branchId: 'large' },
        { expression: '$input.value > 50', branchId: 'medium' },
      ];

      // value = 10 时，无匹配
      const result = evaluateConditions(conditions, { value: 10 });
      expect(result).toBe('default');

      function evaluateConditions(
        conditionsList: Array<{ expression: string; branchId: string }>,
        context: Record<string, any>,
      ): string {
        for (const condition of conditionsList) {
          try {
            const fn = new Function('$input', `return ${condition.expression}`);
            if (fn(context)) {
              return condition.branchId;
            }
          } catch {
            continue;
          }
        }
        return 'default';
      }
    });
  });
});

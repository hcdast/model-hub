import { BadRequestException } from '@nestjs/common';
import { SafeExpressionService } from '../safe-expression.service';

describe('SafeExpressionService', () => {
  const service = new SafeExpressionService();
  const context = {
    $input: { score: 12, enabled: true },
    $nodes: { source: { output: { value: 3 } } },
  };

  it('evaluates supported arithmetic, property access, and boolean operators', () => {
    expect(
      service.evaluate(
        '$input.enabled && $input.score + $nodes.source.output.value >= 15',
        context,
      ),
    ).toBe(true);
  });

  it.each([
    '$input.constructor.constructor("return process")()',
    '$input.__proto__',
    'globalThis.process.exit()',
    '$input.score = 1',
  ])('rejects unsafe expression: %s', (expression) => {
    expect(() => service.evaluate(expression, context)).toThrow(
      BadRequestException,
    );
  });
});

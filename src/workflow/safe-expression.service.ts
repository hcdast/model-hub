import { BadRequestException, Injectable } from '@nestjs/common';

const FORBIDDEN_PROPERTIES: Record<string, true> = {
  ['__proto__']: true,
  prototype: true,
  constructor: true as const,
};
const MAX_EXPRESSION_LENGTH = 1000;
const MAX_TOKENS = 512;
const MAX_DEPTH = 32;

type TokenType = 'number' | 'string' | 'identifier' | 'operator' | 'punctuation' | 'eof';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

interface ExpressionContext {
  $input?: unknown;
  $workflow?: unknown;
  $nodes?: unknown;
  $item?: unknown;
  $index?: number;
}

@Injectable()
export class SafeExpressionService {
  evaluate(expression: string, context: ExpressionContext): unknown {
    if (typeof expression !== 'string' || expression.trim() === '') {
      throw new BadRequestException({
        code: 'EXPRESSION_NOT_ALLOWED',
        message: 'Expression must be a non-empty string',
      });
    }
    if (expression.length > MAX_EXPRESSION_LENGTH) {
      throw new BadRequestException({
        code: 'EXPRESSION_NOT_ALLOWED',
        message: `Expression exceeds ${MAX_EXPRESSION_LENGTH} characters`,
      });
    }

    try {
      const parser = new SafeExpressionParser(this.tokenize(expression), context);
      return parser.parse();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException({
        code: 'EXPRESSION_NOT_ALLOWED',
        message: error instanceof Error ? error.message : 'Invalid expression',
      });
    }
  }

  private tokenize(expression: string): Token[] {
    const tokens: Token[] = [];
    let index = 0;

    const push = (type: TokenType, value: string, position: number) => {
      tokens.push({ type, value, position });
      if (tokens.length > MAX_TOKENS) {
        throw new Error(`Expression exceeds ${MAX_TOKENS} tokens`);
      }
    };

    while (index < expression.length) {
      const char = expression[index];
      if (/\s/.test(char)) {
        index += 1;
        continue;
      }

      const position = index;
      const three = expression.slice(index, index + 3);
      const two = expression.slice(index, index + 2);
      if (['===', '!=='].includes(three)) {
        push('operator', three, position);
        index += 3;
        continue;
      }
      if (['&&', '||', '==', '!=', '>=', '<='].includes(two)) {
        push('operator', two, position);
        index += 2;
        continue;
      }
      if ('+-*/%><!'.includes(char)) {
        push('operator', char, position);
        index += 1;
        continue;
      }
      if ('().[]'.includes(char)) {
        push('punctuation', char, position);
        index += 1;
        continue;
      }

      if (char === '"' || char === "'") {
        const quote = char;
        index += 1;
        let value = '';
        let closed = false;
        while (index < expression.length) {
          const current = expression[index];
          if (current === quote) {
            closed = true;
            index += 1;
            break;
          }
          if (current === '\\') {
            const escaped = expression[index + 1];
            const escapeMap: Record<string, string> = {
              n: '\n',
              r: '\r',
              t: '\t',
              '\\': '\\',
              '"': '"',
              "'": "'",
            };
            if (escaped == null || !(escaped in escapeMap)) {
              throw new Error(`Unsupported escape sequence at position ${index}`);
            }
            value += escapeMap[escaped];
            index += 2;
            continue;
          }
          value += current;
          index += 1;
        }
        if (!closed) throw new Error(`Unterminated string at position ${position}`);
        push('string', value, position);
        continue;
      }

      const numberMatch = expression.slice(index).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
      if (numberMatch) {
        push('number', numberMatch[0], position);
        index += numberMatch[0].length;
        continue;
      }

      const identifierMatch = expression.slice(index).match(/^[$A-Za-z_][$\w]*/);
      if (identifierMatch) {
        push('identifier', identifierMatch[0], position);
        index += identifierMatch[0].length;
        continue;
      }

      throw new Error(`Unsupported token at position ${position}`);
    }

    tokens.push({ type: 'eof', value: '', position: expression.length });
    return tokens;
  }
}

class SafeExpressionParser {
  private index = 0;
  private depth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly context: ExpressionContext,
  ) {}

  parse(): unknown {
    const value = this.parseOr();
    this.expect('eof');
    return value;
  }

  private parseOr(): unknown {
    let value = this.parseAnd();
    while (this.matchOperator('||')) {
      const right = this.parseAnd();
      value = Boolean(value) || Boolean(right);
    }
    return value;
  }

  private parseAnd(): unknown {
    let value = this.parseEquality();
    while (this.matchOperator('&&')) {
      const right = this.parseEquality();
      value = Boolean(value) && Boolean(right);
    }
    return value;
  }

  private parseEquality(): unknown {
    let value = this.parseComparison();
    while (this.isOperator('==', '!=', '===', '!==')) {
      const operator = this.consume().value;
      const right = this.parseComparison();
      if (operator === '==' || operator === '===') value = value === right;
      else value = value !== right;
    }
    return value;
  }

  private parseComparison(): unknown {
    let value = this.parseAdditive();
    while (this.isOperator('>', '>=', '<', '<=')) {
      const operator = this.consume().value;
      const right = this.parseAdditive();
      switch (operator) {
        case '>': value = (value as never) > (right as never); break;
        case '>=': value = (value as never) >= (right as never); break;
        case '<': value = (value as never) < (right as never); break;
        case '<=': value = (value as never) <= (right as never); break;
      }
    }
    return value;
  }

  private parseAdditive(): unknown {
    let value = this.parseMultiplicative();
    while (this.isOperator('+', '-')) {
      const operator = this.consume().value;
      const right = this.parseMultiplicative();
      if (operator === '+') {
        value = typeof value === 'string' || typeof right === 'string'
          ? String(value) + String(right)
          : this.asNumber(value) + this.asNumber(right);
      } else {
        value = this.asNumber(value) - this.asNumber(right);
      }
    }
    return value;
  }

  private parseMultiplicative(): unknown {
    let value = this.parseUnary();
    while (this.isOperator('*', '/', '%')) {
      const operator = this.consume().value;
      const right = this.asNumber(this.parseUnary());
      const left = this.asNumber(value);
      if ((operator === '/' || operator === '%') && right === 0) {
        throw new Error('Division by zero is not allowed');
      }
      if (operator === '*') value = left * right;
      else if (operator === '/') value = left / right;
      else value = left % right;
    }
    return value;
  }

  private parseUnary(): unknown {
    if (this.matchOperator('!')) return !Boolean(this.parseUnary());
    if (this.matchOperator('-')) return -this.asNumber(this.parseUnary());
    if (this.matchOperator('+')) return this.asNumber(this.parseUnary());
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw new Error(`Expression exceeds maximum depth ${MAX_DEPTH}`);
    try {
      const token = this.current();
      if (token.type === 'number') {
        this.consume();
        return Number(token.value);
      }
      if (token.type === 'string') {
        this.consume();
        return token.value;
      }
      if (token.type === 'identifier') {
        this.consume();
        if (token.value === 'true') return true;
        if (token.value === 'false') return false;
        if (token.value === 'null') return null;
        if (!['$input', '$workflow', '$nodes', '$item', '$index'].includes(token.value)) {
          throw new Error(`Identifier ${token.value} is not allowed`);
        }
        let value = this.context[token.value as keyof ExpressionContext];
        while (true) {
          if (this.matchPunctuation('.')) {
            const property = this.expect('identifier').value;
            value = this.readProperty(value, property);
            continue;
          }
          if (this.matchPunctuation('[')) {
            const propertyToken = this.current();
            if (propertyToken.type !== 'string' && propertyToken.type !== 'number') {
              throw new Error('Only literal property access is allowed');
            }
            this.consume();
            this.expect('punctuation', ']');
            value = this.readProperty(value, propertyToken.value);
            continue;
          }
          if (this.isPunctuation('(')) throw new Error('Function calls are not allowed');
          break;
        }
        return value;
      }
      if (this.matchPunctuation('(')) {
        const value = this.parseOr();
        this.expect('punctuation', ')');
        return value;
      }
      throw new Error(`Unexpected token at position ${token.position}`);
    } finally {
      this.depth -= 1;
    }
  }

  private readProperty(value: unknown, property: string): unknown {
    if (FORBIDDEN_PROPERTIES[property]) {
      throw new Error(`Property ${property} is not allowed`);
    }
    if (
      value == null ||
      (typeof value !== 'object' && typeof value !== 'string')
    ) {
      return undefined;
    }
    const boxed = Object(value);
    if (!Object.prototype.hasOwnProperty.call(boxed, property)) return undefined;
    return Reflect.get(boxed, property);
  }

  private asNumber(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('Numeric operator requires finite numbers');
    }
    return value;
  }

  private current(): Token {
    return this.tokens[this.index];
  }

  private consume(): Token {
    return this.tokens[this.index++];
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.current();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(`Expected ${value ?? type} at position ${token.position}`);
    }
    return this.consume();
  }

  private isOperator(...values: string[]): boolean {
    const token = this.current();
    return token.type === 'operator' && values.includes(token.value);
  }

  private matchOperator(value: string): boolean {
    if (!this.isOperator(value)) return false;
    this.consume();
    return true;
  }

  private isPunctuation(value: string): boolean {
    const token = this.current();
    return token.type === 'punctuation' && token.value === value;
  }

  private matchPunctuation(value: string): boolean {
    if (!this.isPunctuation(value)) return false;
    this.consume();
    return true;
  }
}

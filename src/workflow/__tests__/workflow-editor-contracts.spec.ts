import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWorkflowDto } from '../dto/update-workflow.dto';
import { ListWorkflowRunsQueryDto } from '../dto/create-workflow.dto';
import { assignPortInput, modelTaskOutput, readOutputPort } from '../workflow-ports';
import { ExecutionGraphResolver } from '../execution-graph.resolver';
import { Workflow } from '../../database/schemas/workflow.schema';
import { compatibleParams, validateParam } from '../../../portal/src/utils/model-params.util';
import type { ParamDefinition } from '../../../portal/src/types/model-params';

describe('Workflow editor contracts', () => {
  it('preserves bounded rich text, messages, viewport and edge metadata through DTO whitelist', async () => {
    const payload = {
      nodes: [{ id: 'a', type: 'model', position: { x: 1, y: 2 }, data: {
        modelId: 'm', parameters: { prompt: 'hello' },
        textDocument: { blocks: [{ type: 'h1', children: [{ text: 'hello', bold: true, italic: true, color: '#112233', html: '<script>bad</script>' }] }] },
        messages: [{ role: 'user', content: 'hello', secret: 'discard' }],
      } }],
      edges: [{ id: 'e', source: { nodeId: 'a', port: 'text' }, target: { nodeId: 'b', port: 'prompt' }, label: 'label', branchId: 'yes' }],
      viewport: { x: 12, y: 34, zoom: 1.5 },
    };
    const dto = plainToInstance(CreateWorkflowDto, payload);
    expect(await validate(dto, { whitelist: true })).toEqual([]);
    expect(dto.nodes[0].data.textDocument?.blocks[0].children[0]).toEqual({ text: 'hello', bold: true, italic: true, color: '#112233' });
    expect(dto.nodes[0].data.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(dto.viewport).toEqual(payload.viewport);
    expect(dto.edges?.[0]).toEqual(payload.edges[0]);
  });

  it('rejects arbitrary rich-text node types, CSS, and unbounded history pages', async () => {
    const dto = plainToInstance(CreateWorkflowDto, { nodes: [{ id: 'a', type: 'input', position: { x: 0, y: 0 }, data: {
      textDocument: { blocks: [{ type: 'html', children: [{ text: 'a', color: 'url(javascript:bad)' }] }] },
    } }] });
    expect(await validate(dto, { whitelist: true })).not.toHaveLength(0);
    expect(await validate(plainToInstance(ListWorkflowRunsQueryDto, { page: 0, pageSize: 101, status: 'unknown' }))).toHaveLength(3);
  });

  it.each([
    [['https://cdn.test/out.mp4?token=1'], 'video', 'https://cdn.test/out.mp4?token=1'],
    [{ output: ['https://cdn.test/out.png'] }, 'image', 'https://cdn.test/out.png'],
    [{ results: [{ audio_url: 'https://cdn.test/download?id=1' }] }, 'audio', 'https://cdn.test/download?id=1'],
    [{ text: 'answer' }, 'text', 'answer'],
  ])('adapts real normalized task envelopes without losing raw result', (result, kind, value) => {
    const output = modelTaskOutput('task', result);
    expect(output.result).toBe(result);
    expect(output.output).toBe(result);
    expect(output.json).toBe(result);
    expect(output[kind as string]).toBe(value);
    expect(output.taskId).toBe('task');
  });

  it('does not guess unknown results or silently substitute an object for a missing text port', () => {
    const output = modelTaskOutput('task', { file_id: 'opaque', output: ['https://cdn.test/download'] });
    expect(output.text).toBeUndefined();
    expect(output.image).toBeUndefined();
    expect(() => readOutputPort({ type: 'model' }, output, 'text')).toThrow('缺少输出端口');
    expect(() => assignPortInput({}, { type: 'model' }, 'prompt', output)).toThrow('需要文本');
    expect(() => assignPortInput({}, { type: 'model' }, 'input', { prompt: [] })).toThrow('需要文本');
  });

  it('supports legacy whole-input, transform, model-output and loop-result ports explicitly', () => {
    expect(readOutputPort({ type: 'input' }, { prompt: 'hello' }, 'output')).toEqual({ prompt: 'hello' });
    expect(readOutputPort({ type: 'transform' }, { value: 42 }, 'output')).toBe(42);
    expect(readOutputPort({ type: 'loop' }, { results: [1, 2] }, 'result')).toEqual([1, 2]);
    expect(readOutputPort({ type: 'model' }, { taskId: 'old', result: ['url'] }, 'output')).toEqual(['url']);
    const input = {};
    assignPortInput(input, { type: 'model' }, 'input', { prompt: 'hello', dynamic_provider_option: true });
    expect(input).toEqual({ prompt: 'hello', dynamic_provider_option: true });
    expect(() => readOutputPort({ type: 'input' }, { prompt: 'hello' }, 'typo')).toThrow('缺少输出端口');
  });

  it('maps last-loop object results only to documented result/output aliases', () => {
    const node = { type: 'loop' as const, data: { loopConfig: {
      inputArray: '$input.array', outputMode: 'last' as const, parallelism: 'sequential' as const,
    } } };
    const lastObject = { name: 'final item', results: [1, 2] };
    expect(readOutputPort(node, lastObject, 'result')).toBe(lastObject);
    expect(readOutputPort(node, lastObject, 'output')).toBe(lastObject);
    for (const collision of [{ value: 7, other: 1 }, { result: 'x', other: 1 }, { output: 'x', other: 1 }]) {
      expect(readOutputPort(node, collision, 'result')).toBe(collision);
      expect(readOutputPort(node, collision, 'output')).toBe(collision);
    }
    expect(readOutputPort(node, { value: 7 }, 'result')).toBe(7);
    expect(() => readOutputPort(node, lastObject, 'missing')).toThrow('缺少输出端口');
    expect(() => readOutputPort({ type: 'loop' }, { name: 'no last config' }, 'result')).toThrow('缺少输出端口');
  });

  it('rejects nonexistent source ports while accepting dynamic model parameters', () => {
    const graph = {
      nodes: ['a', 'b'].map((id) => ({ id, type: 'model', data: { modelId: 'm' }, position: { x: 0, y: 0 } })),
      edges: [{ id: 'e', source: { nodeId: 'a', port: 'image' }, target: { nodeId: 'b', port: 'provider_reference_url' } }],
    } as Workflow;
    const resolver = new ExecutionGraphResolver();
    expect(resolver.validate(graph).valid).toBe(true);
    graph.edges[0].source.port = 'nonexistent';
    expect(resolver.validate(graph).errors).toEqual(expect.arrayContaining([expect.objectContaining({ edgeId: 'e' })]));
    graph.edges[0].source.port = '__proto__';
    expect(resolver.validate(graph).valid).toBe(false);
  });

  describe('model parameter compatibility', () => {
    const expectCompatible = (
      previous: Record<string, unknown>,
      definitions: Record<string, ParamDefinition>,
      expected: Record<string, unknown>,
    ) => {
      const result = compatibleParams(previous, definitions);
      expect(result).toEqual(expected);
      for (const [name, value] of Object.entries(result)) {
        expect(validateParam({ ...definitions[name], name }, value, result)).toBeUndefined();
      }
    };

    it('keeps valid defaults when old enum, range or type contracts no longer match', () => {
      expectCompatible({ duration: 10, steps: 20, mode: 3, enabled: false, seed: 0 }, {
        duration: { type: 'integer', required: true, enum: [5], default: 5 },
        steps: { type: 'number', required: true, min: 1, max: 10, default: 4 },
        mode: { type: 'string', required: true, default: 'fast' },
        enabled: { type: 'boolean', required: true, default: true },
        seed: { type: 'integer', required: true, default: 42 },
      }, { duration: 5, steps: 4, mode: 'fast', enabled: false, seed: 0 });
    });

    it('does not invent enum defaults or retain invalid defaults', () => {
      expectCompatible({ duration: 10, steps: 20, mode: 'old' }, {
        duration: { type: 'integer', required: true, enum: [5] },
        steps: { type: 'integer', required: true, max: 10, default: 20 },
        mode: { type: 'string', required: true, enum: ['fast'], default: 'slow' },
        enabled: { type: 'boolean', required: true, default: false },
        seed: { type: 'integer', required: true, default: 0 },
      }, { enabled: false, seed: 0 });
    });

    it('evaluates reversed dependency chains using final parent values', () => {
      const definitions: Record<string, ParamDefinition> = {
        duration: { type: 'integer', required: true, default: 5,
          enumDependsOn: { param: 'resolution', map: { small: [5], large: [10] } } },
        resolution: { type: 'string', required: true, default: 'small',
          enumDependsOn: { param: 'mode', map: { fast: ['small'], quality: ['large'] } } },
        mode: { type: 'string', required: true, enum: ['fast', 'quality'], default: 'fast' },
      };
      const previous = { duration: 10, resolution: 'large', mode: 'removed' };
      expectCompatible(previous, definitions, { mode: 'fast', resolution: 'small', duration: 5 });
      expectCompatible(previous, Object.fromEntries(Object.entries(definitions).reverse()), {
        mode: 'fast', resolution: 'small', duration: 5,
      });
      expectCompatible({ ...previous, mode: 'quality' }, definitions, {
        mode: 'quality', resolution: 'large', duration: 10,
      });
    });

    it('drops removed and hidden parameters and options without a usable dependency', () => {
      expectCompatible({ removed: 'old', hidden: 'fast', missingOption: 5, hiddenOption: 5 }, {
        hidden: { type: 'string', required: true, default: 'fast', hide: true },
        missingOption: { type: 'integer', required: true, default: 5,
          enumDependsOn: { param: 'missing', map: { fast: [5] } } },
        hiddenOption: { type: 'integer', required: true, default: 5,
          enumDependsOn: { param: 'hidden', map: { fast: [5] } } },
      }, {});
    });

    it('uses only mutually valid defaults in cycles and resolves their downstream options', () => {
      expectCompatible({ left: 'oldLeft', right: 'oldRight', downstream: 'old' }, {
        downstream: { type: 'string', required: true, default: 'new',
          enumDependsOn: { param: 'left', map: { left: ['new'], oldLeft: ['old'] } } },
        left: { type: 'string', required: true, default: 'left',
          enumDependsOn: { param: 'right', map: { right: ['left'], oldRight: ['oldLeft'] } } },
        right: { type: 'string', required: true, default: 'right',
          enumDependsOn: { param: 'left', map: { left: ['right'], oldLeft: ['oldRight'] } } },
      }, { left: 'left', right: 'right', downstream: 'new' });
    });

    it('removes invalid cyclic defaults transitively and handles self-dependencies', () => {
      expectCompatible({ left: 'old', right: 'old', self: 'old', noDefault: 'old' }, {
        left: { type: 'string', required: true, default: 'left',
          enumDependsOn: { param: 'right', map: { right: ['left'] } } },
        right: { type: 'string', required: true, default: 'right',
          enumDependsOn: { param: 'left', map: { left: ['different'] } } },
        self: { type: 'string', required: true, default: 'self',
          enumDependsOn: { param: 'self', map: { self: ['self'], old: ['old'] } } },
        noDefault: { type: 'string', required: true,
          enumDependsOn: { param: 'noDefault', map: { old: ['old'] } } },
        downstream: { type: 'string', required: true, default: 'child',
          enumDependsOn: { param: 'left', map: { left: ['child'] } } },
      }, { self: 'self' });
    });
  });
});

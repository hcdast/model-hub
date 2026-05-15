import { generateParamDoc } from './param-doc-generator';
import type { ParamDefinition } from '../interfaces/param-definition.interface';
import { ModelConfig } from '../../database/schemas/model-config.schema';

function modelCfg(params: Record<string, ParamDefinition>): ModelConfig {
  return {
    model_id: 'test/model',
    model_type: 'textToImage',
    provider: 'TestProvider',
    model_name: 'Test Model',
    description: '',
    tags: [],
    sort: 0,
    disabled: false,
    unit_price_map: {},
    params: params as any,
    create_time: 0,
    update_time: 0,
  } as ModelConfig;
}

/**
 * Feature: unified-model-params, Property 9: 文档生成完整性
 */
describe('Property 9: 文档生成完整性', () => {
  it('应包含非隐藏参数、排除 hide，并保留 enumDependsOn', () => {
    const params: Record<string, ParamDefinition> = {
      aspect_ratio: {
        required: false,
        type: 'string',
        enum: ['1:1', '16:9'],
      },
      resolution: {
        required: false,
        type: 'string',
        enum: ['512x512', '1024x1024', '1280x720'],
        enumDependsOn: {
          param: 'aspect_ratio',
          map: {
            '1:1': ['512x512', '1024x1024'],
            '16:9': ['1280x720'],
          },
        },
      },
      internal: { required: false, type: 'string', hide: true },
    };

    const doc = generateParamDoc(modelCfg(params));
    const names = doc.params.map((p) => p.name);

    expect(names).toContain('aspect_ratio');
    expect(names).toContain('resolution');
    expect(names).not.toContain('internal');

    const res = doc.params.find((p) => p.name === 'resolution');
    expect(res?.enumDependsOn?.param).toBe('aspect_ratio');
    expect(res?.enumDependsOn?.map['1:1']).toEqual(['512x512', '1024x1024']);
  });
});

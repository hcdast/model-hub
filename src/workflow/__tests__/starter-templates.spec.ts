import { Types } from 'mongoose';
import { buildStarterTemplates } from '../starter-templates';
import { ExecutionGraphResolver } from '../execution-graph.resolver';
import { Workflow } from '../../database/schemas/workflow.schema';
import { validateParams } from '../../common/utils/param-validator';

const contracts: Array<[string, string, string, Record<string, any>]> = [
  ['akool/text-to-image', 'textToImage', 'akool', { prompt: { type: 'string', required: true } }],
  ['akool/image-to-image', 'imageToImage', 'akool', { prompt: { type: 'string', required: true }, source_image: { type: 'string', required: true, format: 'uri' } }],
  ['AkoolText2VideoFastV1/text-to-video', 'textToVideo', 'akool', { prompt: { type: 'string', required: true }, duration: { type: 'number', required: true, enum: [5, 10] } }],
  ['AkoolImage2VideoFastV1/image-to-video', 'imageToVideo', 'akool', { prompt: { type: 'string', required: true }, image: { type: 'string', required: true, format: 'uri' } }],
  ['elevenlabs/tts', 'tts', 'elevenlabs', { text: { type: 'string', required: true } }],
  ['gemini-3.1-pro/text-generate', 'textGenerate', 'akool', { prompt: { type: 'string', required: true } }],
];
const models = contracts.map(([model_id, model_type, provider, params]) => ({ _id: new Types.ObjectId(), model_id, model_type, provider, model_name: model_id, params, revision: 4, disabled: false }));

describe('Official starter workflow content', () => {
  it('builds all eight model-bound graphs and merges user inputs into valid model parameters', () => {
    const { templates, skipped } = buildStarterTemplates(models);
    expect(skipped).toEqual([]); expect(templates).toHaveLength(8);
    const resolver = new ExecutionGraphResolver();
    for (const template of templates) {
      const definition = template.workflowDefinition;
      expect(resolver.validate(definition as Workflow).valid).toBe(true);
      const node = definition.nodes.find(item => item.id === 'model')!;
      const model = models.find(item => String(item._id) === node.data.modelSelection!.configId)!;
      expect(node.data.modelSelection).toMatchObject({ configRevision: 4, provider: model.provider, featureType: model.model_type });
      const input = Object.fromEntries(Object.entries(definition.inputSchema!).map(([key, field]) => [key, field.type === 'image' ? 'https://assets.example.com/upload.png' : 'My own creative text']));
      const dynamic = resolver.resolveNodeInput('model', resolver.resolve(definition as Workflow), { nodeOutputs: new Map([['input', input]]) } as any);
      expect(validateParams({ ...node.data.parameters, ...dynamic }, model.params).valid).toBe(true);
      expect(dynamic).toEqual(input);
      expect(template.examples).toEqual([]);
      expect(template.source).toBe('official');
      expect(JSON.stringify(definition)).not.toContain('example.com/your-image.png');
    }
  });

  it('skips missing, disabled or incompatible model contracts instead of publishing broken templates', () => {
    expect(buildStarterTemplates([]).templates).toEqual([]);
    const incompatible = models.map(model => ({ ...model, params: { ...model.params, newRequiredField: { type: 'string' as const, required: true } } }));
    expect(buildStarterTemplates(incompatible).templates).toEqual([]);
    expect(buildStarterTemplates(models.map(model => ({ ...model, disabled: true }))).templates).toEqual([]);
  });

  it('keeps stable template IDs while rebinding to each environment model configuration', () => {
    const first = buildStarterTemplates(models).templates;
    const second = buildStarterTemplates(models.map(model => ({ ...model, _id: new Types.ObjectId() }))).templates;
    expect(second.map(item => String(item._id))).toEqual(first.map(item => String(item._id)));
    expect(second[0].workflowDefinition.nodes[1].data.modelSelection!.configId).not.toEqual(first[0].workflowDefinition.nodes[1].data.modelSelection!.configId);
  });
});

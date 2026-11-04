import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PublicModelCatalogController } from './public-model-catalog.controller';
import { ModelConfigController } from './model-config.controller';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { ModelConfig } from '../database/schemas/model-config.schema';
import { ResponseTransformInterceptor } from '../common/interceptors/response-transform.interceptor';
import { buildModelExamples, buildModelInput } from '../../portal/src/utils/model-doc-example';
import { translate, messages } from '../../portal/src/i18n/messages';

describe('Public model catalog', () => {
  let app: INestApplication;
  let base: string;
  const record = {
    _id: '507f1f77bcf86cd799439011', model_id: 'vendor/model/edit', model_type: 'imageToImage', model_name: 'Image editor',
    provider: 'vendor', description: 'Public description', tags: ['image', { internal: 'private' }],
    provider_model_name: 'private-route', unit_price_map: { internal: 'private-price' }, disabled: false,
    params: { prompt: { type: 'string', required: true, description: 'Describe the image' },
      size: { type: 'integer', required: false, default: 1024, min: 256, max: 2048 },
      private_key: { type: 'string', required: true, default: 'secret', hide: true },
      ui: { sections: ['private layout'] }, empty_metadata: null },
  };
  const query = { select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn() };
  const model = { find: jest.fn(() => query), findOne: jest.fn(() => query) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [PublicModelCatalogController], providers: [{ provide: getModelToken(ModelConfig.name), useValue: model }] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it('lists enabled models anonymously, publishing only catalog fields', async () => {
    query.lean.mockResolvedValueOnce([record]);
    const response = await fetch(`${base}/v1/catalog/models`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ code: 0, data: { total: 1, items: [{ model_id: record.model_id, tags: ['image'] }] } });
    expect(model.find).toHaveBeenCalledWith({ disabled: { $ne: true } });
    expect(query.select).toHaveBeenCalledWith('model_id model_type model_name provider description tags sort');
    expect(JSON.stringify(body)).not.toMatch(/private|secret|unit_price_map|params/);
  });

  it('serves slash-containing IDs and capability-specific docs without hidden fields', async () => {
    query.lean.mockResolvedValueOnce(record);
    const response = await fetch(`${base}/v1/catalog/models/detail?model_id=${encodeURIComponent(record.model_id)}&model_type=imageToImage&provider=vendor`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.params).toEqual([
      { name: 'prompt', type: 'string', required: true, description: 'Describe the image' },
      { name: 'size', type: 'integer', required: false, default: 1024, min: 256, max: 2048 },
    ]);
    expect(model.findOne).toHaveBeenCalledWith({ model_id: record.model_id, model_type: 'imageToImage', provider: 'vendor', disabled: { $ne: true } });
    expect(JSON.stringify(body)).not.toMatch(/private|secret|unit_price_map/);
  });

  it('rejects missing and structured model identifiers', async () => {
    for (const suffix of ['', '?model_id[]=a', '?model_id=a&model_type[]=imageToImage']) {
      expect((await fetch(`${base}/v1/catalog/models/detail${suffix}`)).status).toBe(400);
    }
    expect(model.findOne).not.toHaveBeenCalled();
  });
  it('publishes v2 docs, rules, output and credit tiers without draft or provider cost', async () => {
    query.lean.mockResolvedValueOnce({ ...record, contract_version: 2, revision: 3,
      draft: { description: 'private draft' }, history: ['private history'],
      ui_schema: { order: ['prompt', 'private_key'] },
      params_rules: [{ when: [], require: ['prompt'] }, { when: [], require: ['private_key'] }],
      docs: { sections: [{ title: 'Usage', content: 'Instructions' }] },
      output_schema: { type: 'array', required: false, items: { type: 'string', required: true, media: { kind: 'image' }, third_party_field: 'private mapping' } },
      unit_price_map: { default: { unit_credit: 3, cost_unit_price: 999 } },
      pricing: { usage_param: 'prompt', tier_param: 'size', auto_value: -1, auto_prelock_units: 30, tier_rules: [
        { when: [{ field: 'prompt', operator: 'present' }], tier: 'default' },
        { when: [{ field: 'private_key', operator: 'eq', value: 'secret' }], tier: 'default' },
      ] },
      examples: [{ name: 'Example', input: { prompt: 'test', private_key: 'secret' } }],
    });
    const response = await fetch(`${base}/v1/catalog/models/detail?model_id=${encodeURIComponent(record.model_id)}`);
    const body = await response.json();
    expect(body.data).toMatchObject({ config_id: record._id, revision: 3, contract_version: 2,
      ui_schema: { order: ['prompt'] }, params_rules: [{ when: [], require: ['prompt'] }],
      docs: { sections: [{ title: 'Usage', content: 'Instructions' }] }, public_pricing: { tiers: { default: 3 }, usage_param: 'prompt', tier_param: 'size', auto_value: -1,
        tier_rules: [{ when: [{ field: 'prompt', operator: 'present' }], tier: 'default' }] },
      examples: [{ input: { prompt: 'test' } }],
    });
    expect(JSON.stringify(body)).not.toMatch(/private|secret|999|cost_unit_price|third_party_field/);
    expect(body.data.public_pricing.tier_rules).toHaveLength(1);
  });

  it('returns 404 for missing or disabled models', async () => {
    query.lean.mockResolvedValueOnce(null);
    expect((await fetch(`${base}/v1/catalog/models/detail?model_id=disabled`)).status).toBe(404);
    expect(model.findOne).toHaveBeenCalledWith({ model_id: 'disabled', disabled: { $ne: true } });
  });
  it('selects the exact public configuration when model/type/provider are shared', async () => {
    query.lean.mockResolvedValueOnce(record);
    const response = await fetch(`${base}/v1/catalog/models/detail?model_id=${encodeURIComponent(record.model_id)}&config_id=${record._id}`);
    expect(response.status).toBe(200);
    expect(model.findOne).toHaveBeenCalledWith({ _id: record._id, model_id: record.model_id, disabled: { $ne: true } });
    expect((await fetch(`${base}/v1/catalog/models/detail?model_id=a&config_id[]=a`)).status).toBe(400);
  });

  it('preserves authentication on the existing full model configuration API', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ModelConfigController)).toContain(ApiKeyOrJwtGuard);
  });

  it('generates task API examples from public parameter definitions without losing false or zero', () => {
    const params = [
      { name: 'prompt', type: 'string' as const, required: true },
      { name: 'seed', type: 'integer' as const, required: false, default: 0 },
      { name: 'audio', type: 'boolean' as const, required: false, default: false },
      { name: 'internal', type: 'string' as const, required: true, hide: true, default: 'secret' },
    ];
    expect(buildModelInput(params)).toEqual({ prompt: expect.any(String), seed: 0, audio: false });
    const examples = buildModelExamples("vendor/model's-name", 'textToImage', params);
    expect(JSON.parse(examples.json)).toMatchObject({ model_id: "vendor/model's-name", options: { featureType: 'textToImage' }, input: { seed: 0, audio: false } });
    expect(examples.curl).toContain('/v1/tasks');
    expect(examples.curl).not.toContain('\n+');
    expect(examples.curl).toContain(`'"'"'`);
    expect(examples.python).toContain('MODEL_HUB_API_KEY');
    expect(examples.poll).toContain('$TASK_ID');
    expect(examples.json).not.toContain('secret');
  });

  it('has Chinese and Japanese translations for every localized UI key', () => {
    for (const [key, translations] of Object.entries(messages)) {
      expect(translations[0].trim()).not.toBe(''); expect(translations[1].trim()).not.toBe('');
      expect(translate('zh', key)).toBe(translations[0]); expect(translate('ja', key)).toBe(translations[1]);
    }
    expect(translate('en', 'Models')).toBe('Models');
    expect(translate('ja', 'custom-provider')).toBe('custom-provider');
  });
});

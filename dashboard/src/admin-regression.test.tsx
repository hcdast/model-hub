import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
const auth = vi.hoisted(() => ({ roles: [] as string[], permissions: [] as string[] }));
vi.mock('./store/auth', () => ({ useAuthStore: (selector: any) => selector(auth) }));
import api, { modelApi } from './services/api';
import { usePermission } from './hooks/usePermission';
import { validateModelContract } from '@model-hub/common/utils/model-contract';
import { estimateModelPrice } from '@model-hub/common/utils/model-pricing';

describe('Dashboard request and permission regressions', () => {
  afterEach(() => { auth.roles = []; auth.permissions = []; });
  it('rejects HTTP 200 business failures and keeps the backend message for callers', async () => {
    await expect(api.get('/test', { adapter: async config => ({ config, status: 200, statusText: 'OK', headers: {}, data: { code: 1001, message: '配置已变化' } }) })).rejects.toMatchObject({ message: '配置已变化', response: { data: { code: 1001 } } });
  });
  it('returns successful responses without changing the existing envelope', async () => {
    const result = await api.get('/test', { adapter: async config => ({ config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: { total: 41 } } }) });
    expect(result).toEqual({ code: 0, data: { total: 41 } });
  });
  it('rejects a failed model enable and preserves the pricing instructions and validation details', async () => {
    const failure = { code: 1001, message: '启停失败：模型定价不完整，请先在“定价”中填写并保存价格表', errors: [{ field: 'unit_price_map', message: 'unit_price_map 不能为空' }] };
    await expect(api.put('/models/toggle', { id: 'tts', disabled: false }, {
      adapter: async config => ({ config, status: 200, statusText: 'OK', headers: {}, data: failure }),
    })).rejects.toMatchObject({ message: failure.message, response: { data: failure } });
  });
  it.each([0, 7])('saves editable model fields without Mongo metadata and retains revision %s', async expected_revision => {
    const editable = {
      model_id: 'akool-voicelab-tts', provider: 'akool-openapi', model_type: 'tts', model_name: 'VoiceLab',
      disabled: false, sort: 0, tags: [], contract_version: 2,
      params: { text: { type: 'string', required: true } },
      unit_price_map: { default: { cost_unit_price: 0, sale_unit_price: 1, unit_credit: 1 } },
      pricing: { usage_type: 'count', usage_param: 'text', usage_measure: 'characters' },
      params_rules: [], ui_schema: {}, output_schema: {}, docs: {}, examples: [],
    };
    const originalAdapter = api.defaults.adapter;
    const adapter = vi.fn(async config => ({ config, status: 200, statusText: 'OK', headers: {}, data: { code: 0, data: editable } }));
    api.defaults.adapter = adapter;
    try {
      await modelApi.update('mongo-id', {
        ...editable, _id: 'mongo-id', __v: 0, create_time: 1, update_time: 2, revision: expected_revision,
        draft: {}, draft_revision: 3, history: [], expected_revision,
      });
      const request = adapter.mock.calls[0][0];
      expect(request.url).toBe('/models/mongo-id');
      expect(JSON.parse(request.data)).toEqual({ ...editable, expected_revision });
    } finally {
      api.defaults.adapter = originalAdapter;
    }
  });
  function Actions() { const { hasPermission } = usePermission(); return <div>{hasPermission('model:update') && <button>Edit</button>}{hasPermission('provider:delete') && <button>Delete</button>}{hasPermission('model:read') && <span>Read</span>}</div>; }
  it.each([
    ['viewer', ['model:read'], false, false],
    ['operator', ['model:read', 'model:update'], true, false],
    ['super_admin', [], true, true],
  ])('renders actions consistently for %s', (role, permissions, canEdit, canDelete) => {
    auth.roles = [role as string]; auth.permissions = permissions as string[];
    const html = renderToStaticMarkup(<Actions />);
    expect(html.includes('Edit')).toBe(canEdit); expect(html.includes('Delete')).toBe(canDelete); expect(html).toContain('Read');
  });
  it('uses the same contract validator and conditional pricing for editor trial calculations', () => {
    const config: any = { model_type: 'textToVideo', params: { duration: { type: 'integer', required: true, enum: [5, 10] }, hd: { type: 'boolean', required: false } }, unit_price_map: { default: { unit_credit: 2 }, hd: { unit_credit: 3 } }, pricing: { usage_type: 'duration', usage_param: 'duration', tier_rules: [{ when: [{ field: 'hd', operator: 'eq', value: true }], tier: 'hd' }] } };
    expect(validateModelContract(config)).toEqual([]);
    expect(estimateModelPrice(config, { duration: 5, hd: true }).estimatedCost).toBe(15);
    expect(validateModelContract({ ...config, unit_price_map: { default: { unit_credit: 2 } } }).length).toBeGreaterThan(0);
  });
});

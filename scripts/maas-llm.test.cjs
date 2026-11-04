const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepare } = require('./prepare-maas-llm.cjs');
test('does not manufacture a model ID or price', () => {
  assert.throws(() => prepare('REPLACE_WITH_VERIFIED_MODEL_ID', {}), /verified/);
  const unpriced = prepare('local-fixture-model');
  assert.equal(unpriced.disabled, true);
  assert.equal(unpriced.unit_price_map, undefined);
  assert.throws(() => prepare('local-fixture-model', { default: { unit_credit: 0 } }));
});
test('keeps explicit LLM routing hidden, pricing token-based, and prepared configs disabled', () => {
  const config = prepare('local-fixture-model', { default: { unit_credit: 0.001, sale_unit_price: 0.00001, cost_unit_price: 0.000005 } });
  assert.equal(config.disabled, true);
  assert.equal(config.model_type, 'textGenerate');
  assert.equal(config.params.maas_protocol.hide, true);
  assert.deepEqual(config.params.maas_protocol.enum, ['chat-completions']);
  assert.equal(config.pricing.usage_type, 'token');
});

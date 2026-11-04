/** Offline only: prepare a disabled LLM config after a model ID and credit prices are verified. */
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, project: path.join(__dirname, '../tsconfig.json') });
const { validateModelContract } = require('../src/common/utils/model-contract');
const { ModelConfigValidator } = require('../src/admin/utils/model-config-validator');

function prepare(modelId, prices) {
  if (typeof modelId !== 'string' || !modelId.trim() || modelId.length > 200 || /REPLACE_|\s/.test(modelId)) throw new Error('Provide the verified ID returned by GET /v1/models');
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/common/fixtures/maas-llm.contract.json'), 'utf8'));
  contract.model_id = modelId;
  contract.model_name = `MaaS 编剧 · ${modelId}`;
  contract.unit_price_map = prices;
  const validation = ModelConfigValidator.validateConfig(contract);
  const errors = [...validation.errors.map(e => e.message), ...validateModelContract(contract)];
  if (errors.length) throw new Error(errors.join('; '));
  return contract;
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2), value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
    if (!value('--pricing')) throw new Error('Provide --pricing with a verified Portal unit_price_map in credits per token; no default price is assumed');
    const config = prepare(value('--model-id'), JSON.parse(fs.readFileSync(value('--pricing'), 'utf8')));
    if (value('--out')) { fs.writeFileSync(value('--out'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx' }); console.log('Created disabled LLM configuration; review model limits and pricing before enabling.'); }
    else console.log(JSON.stringify(config, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare };

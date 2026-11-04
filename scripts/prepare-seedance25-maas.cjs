/** Offline only. Require explicit verified prices; never writes MongoDB or calls a provider. */
const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.join(__dirname, '../tsconfig.json') });
const { validateModelContract } = require('../src/common/utils/model-contract');
const { ModelConfigValidator } = require('../src/admin/utils/model-config-validator');

function prepare(prices) {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/common/fixtures/seedance25-maas.contract.json'), 'utf8'));
  const errors = validateModelContract(contract);
  if (errors.length) throw new Error(errors.join('; '));
  const tiers = [...new Set(['default', ...contract.params.resolution.enum, ...(contract.pricing.tier_rules || []).map(rule => rule.tier)])];
  if (!prices) return { contract, ready: false, reason: `Missing verified unit_price_map (${tiers.join(', ')})` };
  for (const name of tiers) {
    const validation = ModelConfigValidator.validateConfig({ ...contract, unit_price_map: { default: prices[name] } });
    if (!validation.valid) throw new Error(`${name}: ${validation.errors.map(e => e.message).join('; ')}`);
  }
  const pricingErrors = validateModelContract({ ...contract, unit_price_map: prices });
  if (pricingErrors.length) throw new Error(pricingErrors.join('; '));
  return { contract: { ...contract, unit_price_map: prices, disabled: true }, ready: true };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
    const pricingFile = value('--pricing');
    const result = prepare(pricingFile ? JSON.parse(fs.readFileSync(pricingFile, 'utf8')) : undefined);
    if (!result.ready) {
      console.log(JSON.stringify({ contract_valid: true, import_ready: false, reason: result.reason }, null, 2));
      if (value('--out')) throw new Error('--out requires --pricing with verified prices');
    } else if (value('--out')) {
      fs.writeFileSync(value('--out'), JSON.stringify(result.contract, null, 2) + '\n', { flag: 'wx' });
      console.log('Created disabled model configuration. Review before creating/publishing it in the admin UI.');
    } else console.log(JSON.stringify(result.contract, null, 2));
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
module.exports = { prepare };

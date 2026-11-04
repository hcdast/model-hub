/** Read-only preflight by default; --run submits exactly one fixed-duration test task. */
const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.join(__dirname, '../tsconfig.json') });
const { validateParams } = require('../src/common/utils/param-validator');
const { resolveModelPriceTier } = require('../src/common/utils/model-pricing');

async function main() {
  const args = process.argv.slice(2);
  const value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const rawBase = process.env.MODEL_HUB_API_BASE;
  if (!rawBase) throw new Error('Set MODEL_HUB_API_BASE to the model-hub FAT API prefix (for example https://your-fat-host/api/v1)');
  const base = new URL(rawBase);
  if (base.username || base.password || base.search || base.hash) throw new Error('API base must not contain credentials, query or fragment');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Use HTTPS for remote FAT');
  const prefix = rawBase.replace(/\/$/, '');
  const request = async (endpoint, options = {}) => {
    const res = await fetch(prefix + endpoint, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${endpoint.split('?')[0]}`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(`Business error ${json.code} on ${endpoint.split('?')[0]}`);
    return json.data;
  };
  const query = new URLSearchParams({ model_id: 'seedance-2-5/reference-to-video', model_type: 'referenceToVideo', provider: 'akool-maas' });
  const doc = await request(`/catalog/models/detail?${query}`);
  if (doc.contract_version !== 2 || !doc.config_id || !Array.isArray(doc.params)) throw new Error('FAT does not expose the expected v2 model contract');
  const definitions = Object.fromEntries(doc.params.map(({ name, ...definition }) => [name, definition]));
  for (const field of ['images', 'videos', 'audios', 'omni_reference_task_type', 'return_last_frame']) if (!definitions[field]) throw new Error(`FAT contract missing ${field}`);
  console.log(JSON.stringify({ phase: 'catalog', contract_valid: true, config_id: doc.config_id, revision: doc.revision, ready_for_manual_price_review: true }));
  if (!args.includes('--run') && !value('--task-id')) return;
  const apiKey = process.env.MODEL_HUB_API_KEY;
  if (!apiKey) throw new Error('Set MODEL_HUB_API_KEY in the process environment; do not put it on the command line');
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };
  let taskId = value('--task-id');
  if (!taskId) {
    if (!value('--input')) throw new Error('--run requires --input pointing to an input-only JSON file');
    const input = JSON.parse(fs.readFileSync(value('--input'), 'utf8'));
    const validated = validateParams(input, definitions, doc.params_rules);
    if (!validated.valid) throw new Error(`Invalid test input: ${validated.errors.map(e => e.message).join('; ')}`);
    const duration = validated.sanitized.duration;
    if (!Number.isInteger(duration) || duration < 4 || duration > 30) throw new Error('Smoke submission requires fixed duration 4–30; adaptive duration needs separate billing verification');
    const p = doc.public_pricing;
    if (p?.currency !== 'credit' || p.usage_type !== 'duration' || !p.tier_param) throw new Error('Unexpected pricing contract');
    const tier = resolveModelPriceTier(p, validated.sanitized);
    const unit = p.tiers?.[tier];
    const limit = Number(value('--max-estimated-credits'));
    if (!Number.isFinite(limit) || limit <= 0 || typeof unit !== 'number' || unit <= 0 || unit * duration > limit) throw new Error('Missing/insufficient --max-estimated-credits or missing explicit price tier');
    const idempotency = process.env.MODEL_HUB_IDEMPOTENCY_KEY;
    if (!idempotency) throw new Error('Set a stable MODEL_HUB_IDEMPOTENCY_KEY for this test, and reuse it on retry');
    const created = await request('/tasks', { method: 'POST', headers: { ...headers, 'X-Idempotency-Key': idempotency }, body: JSON.stringify({ model: doc.model_id, input: validated.sanitized, options: { configId: doc.config_id, configRevision: doc.revision, featureType: doc.model_type } }) });
    taskId = created.taskId;
    if (!taskId) throw new Error('Missing taskId in creation response');
    console.log(JSON.stringify({ phase: 'submitted', taskId, estimatedCredits: unit * duration }));
  }
  const deadline = Date.now() + Number(value('--timeout-seconds') || 900) * 1000;
  let lastStatus;
  while (Date.now() < deadline) {
    const task = await request(`/tasks/${encodeURIComponent(taskId)}`, { headers });
    if (task.status !== lastStatus) console.log(JSON.stringify({ phase: 'poll', taskId, status: task.status, billing: task.billing }));
    lastStatus = task.status;
    if (['SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(task.status)) {
      const expected = value('--expect') || 'SUCCESS';
      if (task.status !== expected) throw new Error(`Expected ${expected}; got ${task.status}. Inspect task diagnostics in admin.`);
      if (task.status === 'SUCCESS' && (!task.result || task.billing?.status !== 'settled')) throw new Error('Success requires output and settled billing');
      if (task.status !== 'SUCCESS' && task.billing?.status !== 'refunded') throw new Error('Failure/cancellation requires refunded billing');
      console.log(JSON.stringify({ phase: 'verified', taskId, status: task.status, billing: task.billing, hasOutput: !!task.result }));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error(`Polling timeout; task ${taskId} may still be running. Resume with --task-id; do not submit a new test.`);
}
if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });

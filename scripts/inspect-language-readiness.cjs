/** Read-only readiness evidence. Never submits paid tasks or emits credentials. */
const mongoose = require('mongoose');
const axios = require('axios');
const fs = require('node:fs/promises');
const { Logger } = require('@nestjs/common');
Logger.overrideLogger(false);
async function main() {
  const config = await require('../dist/config/nacos-config.loader').loadAppConfig();
  const connection = await mongoose.createConnection(config.mongodb.uri, { serverSelectionTimeoutMS: 10000 }).asPromise();
  try {
    const db = connection.db, blockers = [];
    const hello = await db.admin().command({ hello: 1, maxTimeMS: 2000 });
    const transactionsReady = !!(hello.setName || hello.msg === 'isdbgrid') && hello.logicalSessionTimeoutMinutes != null;
    if (!transactionsReady) blockers.push('MongoDB: replica set or sharded cluster required for money transactions');
    const models = await db.collection('model_configs').find({ provider: { $in: ['akool-maas', 'akool-openapi'] }, model_type: { $in: ['textGenerate', 'tts'] } },
      { projection: { model_id: 1, model_type: 1, provider: 1, disabled: 1, unit_price_map: 1 } }).toArray();
    const modelStatus = models.map(m => {
      const price = m.unit_price_map?.default;
      const priced = price && Number.isFinite(price.unit_credit) && price.unit_credit > 0 && Number.isFinite(price.sale_unit_price) && price.sale_unit_price > 0 && Number.isFinite(price.cost_unit_price) && price.cost_unit_price >= 0;
      return { configId: String(m._id), modelId: m.model_id, provider: m.provider, type: m.model_type, enabled: m.disabled !== true, priced: !!priced, unitCredit: price?.unit_credit };
    });
    for (const type of ['textGenerate', 'tts']) if (!modelStatus.some(m => m.type === type && m.enabled && m.priced)) blockers.push(`${type}: no enabled and priced configuration`);
    const providers = [], probes = [];
    for (const name of ['akool-maas', 'akool-openapi']) {
      const runtime = await db.collection('provider_runtime_configs').findOne({ provider_name: name });
      const accounts = await db.collection('account_pool_entries').find({ provider_name: name, enabled: true, health_status: { $ne: 'open' } }).toArray();
      const base = name === 'akool-maas' ? runtime?.extra?.llm_base_url : accounts[0]?.base_url || runtime?.base_url;
      providers.push({ provider: name, enabled: runtime?.enabled === true, activeAccounts: accounts.length, endpointConfigured: !!base });
      if (!runtime?.enabled || !accounts.length || !base) { blockers.push(`${name}: provider, account or endpoint incomplete`); continue; }
      const u = new URL(base);
      if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) { blockers.push(`${name}: invalid HTTPS endpoint`); continue; }
      const path = u.pathname.replace(/\/+$/, '');
      if (name === 'akool-openapi' && !['', '/api'].includes(path)) { blockers.push(`${name}: invalid endpoint prefix`); continue; }
      const requestBase = name === 'akool-openapi' ? u.origin : base.replace(/\/+$/, '');
      const suffix = name === 'akool-maas' ? '/models' : '/api/open/v4/voice/list';
      try {
        const response = await axios.get(requestBase + suffix, { headers: name === 'akool-maas' ? { Authorization: `Bearer ${accounts[0].api_key}` } : { 'x-api-key': accounts[0].api_key },
          ...(name === 'akool-openapi' ? { params: { type: 2, page: 1, size: 20 } } : {}), timeout: 15000, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024, validateStatus: () => true });
        const data = response.data;
        const entries = name === 'akool-maas' ? data?.data : data?.data?.result;
        const compatible = Array.isArray(entries) ? entries.filter(v => name === 'akool-maas' || v.status === 3 && v.voice_model_name === 'Akool Multilingual 3') : [];
        probes.push({ provider: name, httpStatus: response.status, ...(name === 'akool-openapi' ? { businessCode: Number.isFinite(data?.code) ? data.code : null, total: data?.data?.count } : {}), entries: Array.isArray(entries) ? entries.length : 0, compatibleEntries: compatible.length });
        if (response.status !== 200 || !Array.isArray(entries) || name === 'akool-openapi' && data.code !== 1000) blockers.push(`${name}: read-only upstream probe failed`);
      } catch { probes.push({ provider: name, error: 'NETWORK_OR_TLS_FAILURE' }); blockers.push(`${name}: read-only upstream probe failed`); }
    }
    const project = await db.collection('short_drama_projects').findOne({ id: '8d0df3a7-8224-4fb7-8791-923c10958c23' }, { projection: { budgetLimit: 1, budgetHolds: 1 } });
    if (!project) blockers.push('acceptance project not found in current database; budget cannot be verified');
    const used = (project?.budgetHolds || []).filter(h => h.settled).reduce((n, h) => n + h.amount, 0), reserved = (project?.budgetHolds || []).filter(h => !h.settled).reduce((n, h) => n + h.amount, 0);
    const report = { checkedAt: new Date().toISOString(), paidGenerationCalls: 0, transactionsReady, models: modelStatus, providers, probes, blockers, projectFound: !!project, budget: project ? { limit: project.budgetLimit, used, reserved } : null };
    const i = process.argv.indexOf('--out'); if (i >= 0) await fs.writeFile(process.argv[i + 1], JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await connection.close(); }
}
main().catch(() => { console.error('Readiness inspection failed; credentials suppressed.'); process.exitCode = 1; });

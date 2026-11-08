/** Read-only local release preflight. Never starts workers, changes indexes or calls paid providers. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Redis = require('ioredis');

const requiredIndexes = [
  { collection: 'creation_template_submissions', key: { ownerId: 1, kind: 1, sourceId: 1, sourceFingerprint: 1 }, unique: true },
  { collection: 'drama_workflow_links', key: { id: 1 }, unique: true },
  { collection: 'drama_workflow_links', key: { workflowId: 1 }, unique: true },
  { collection: 'drama_workflow_budget_tasks', key: { id: 1 }, unique: true },
  { collection: 'drama_workflow_budget_tasks', key: { ownerId: 1, projectId: 1, state: 1 } },
  { collection: 'creation_events', key: { key: 1 }, unique: true },
  { collection: 'creation_events', key: { at: 1 }, expireAfterSeconds: 90 * 86400 },
  { collection: 'creation_events', key: { kind: 1, name: 1, at: -1 } },
  { collection: 'tasks', key: { 'metadata.workflowBudgetId': 1, apiKey: 1 }, sparse: true },
];
async function probe(port, route, expected) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    const json = await response.json().catch(() => null), value = json?.data || json;
    return { port, route, http: response.status, ready: response.status === expected && !!json && (expected !== 200 || value?.status === 'ok'), json: !!json };
  } catch { return { port, route, ready: false, reason: 'UNREACHABLE_OR_NON_JSON' }; }
}
async function main() {
  const root = path.resolve(__dirname, '..'), args = process.argv.slice(2);
  const out = path.resolve(root, args[args.indexOf('--out') + 1] || 'output/creation-local-preflight.json');
  if (!out.startsWith(root + path.sep) || !out.endsWith('.json')) throw new Error('Output must be a workspace JSON file');
  const env = { ...dotenv.parse(await fs.readFile(path.join(root, '.env')).catch(() => '')), ...process.env };
  const mode = env.NODE_ENV || 'development';
  if (!/^[\w-]+$/.test(mode)) throw new Error('Invalid environment');
  const report = { checkedAt: new Date().toISOString(), paidCalls: 0, mutations: 0, configuration: mode, checks: {}, blockers: [], indexPlan: [] };
  report.checks.http = await Promise.all([probe(7000, '/health/readiness', 200), probe(7003, '/health/readiness', 200), probe(7000, '/v1/creation-templates/submissions', 401), probe(7003, '/api/v1/admin/creation-templates/funnel', 401)]);
  if (report.checks.http.some(r => !r.ready)) report.blockers.push('Local API/admin readiness or authentication probe failed');
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const executable = tool === 'ffmpeg' ? env.DRAMA_FFMPEG_PATH || 'ffmpeg' : env.DRAMA_FFPROBE_PATH || (env.DRAMA_FFMPEG_PATH || 'ffmpeg').replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    report.checks[tool] = spawnSync(executable, ['-version'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }).status === 0;
  }
  if (!report.checks.ffmpeg || !report.checks.ffprobe) report.blockers.push('ffmpeg/ffprobe not available on PATH; check configured media tool paths');
  if (['true', '1', 'yes'].includes((env.NACOS_ENABLE || '').toLowerCase())) report.blockers.push('Nacos enabled: resolve the effective configuration before database preflight');
  else {
    const config = JSON.parse(await fs.readFile(path.join(root, 'config', mode + '.json'), 'utf8'));
    report.checks.databaseOnLoopback = /^mongodb:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(config.mongodb?.uri || '');
    if (!report.checks.databaseOnLoopback && !args.includes('--inspect-configured-db')) report.blockers.push('Configured database is not loopback; skipped database inspection. Use --inspect-configured-db for explicit read-only inspection');
    else {
    let connection;
    try {
      connection = mongoose.createConnection(config.mongodb.uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 5000 });
      await connection.asPromise();
      const hello = await connection.db.admin().command({ hello: 1, maxTimeMS: 2000 });
      report.checks.moneyTransactions = !!(hello.setName || hello.msg === 'isdbgrid') && hello.logicalSessionTimeoutMinutes != null;
      if (!report.checks.moneyTransactions) report.blockers.push('Database needs replica set/sharded transaction support');
      for (const required of requiredIndexes) {
        const indexes = await connection.db.collection(required.collection).listIndexes().toArray().catch(error => { if (error.code === 26) return []; throw error; });
        const matching = indexes.find(i => JSON.stringify(i.key) === JSON.stringify(required.key));
        if (!matching || !!matching.unique !== !!required.unique || !!matching.sparse !== !!required.sparse || matching.expireAfterSeconds !== required.expireAfterSeconds) report.indexPlan.push(required);
      }
      if (report.indexPlan.length) report.blockers.push('Required indexes missing or mismatched; review indexPlan before deployment');
      const models = await connection.db.collection('model_configs').find({ disabled: { $ne: true }, model_type: { $in: ['textGenerate', 'textToImage', 'imageToImage', 'textToVideo', 'imageToVideo', 'tts', 'music'] } }, { projection: { model_type: 1 } }).maxTimeMS(5000).toArray();
      report.checks.availableModelTypes = [...new Set(models.map(m => m.model_type))];
      if (!models.some(m => ['textToVideo', 'imageToVideo'].includes(m.model_type)) || !models.some(m => ['textToImage', 'imageToImage'].includes(m.model_type))) report.blockers.push('Image/video model configurations incomplete');
      report.checks.databaseRead = true;
    } catch { report.checks.databaseRead = false; report.blockers.push('Database read-only preflight failed; connection details suppressed'); }
    finally { if (connection) await connection.close(); }
    }
    const redis = new Redis({ ...config.redis, lazyConnect: true, connectTimeout: 5000, commandTimeout: 5000, retryStrategy: () => null }); redis.on('error', () => {});
    try { await redis.connect(); report.checks.redis = await redis.ping() === 'PONG'; } catch { report.checks.redis = false; report.blockers.push('Redis ping failed'); } finally { redis.disconnect(); }
  }
  report.ready = report.blockers.length === 0;
  await fs.mkdir(path.dirname(out), { recursive: true }); await fs.writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.ready ? 0 : 2;
}
main().catch(() => { console.error('Local preflight failed; credentials suppressed.'); process.exitCode = 1; });

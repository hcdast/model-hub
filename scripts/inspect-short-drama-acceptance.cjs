// Read-only acceptance evidence. No credentials or signed media URLs are written.
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const { loadAppConfig } = require('../dist/config/nacos-config.loader');
const { downloadDramaMedia } = require('../dist/short-drama/drama-render.service');
const { dramaMediaMime } = require('../dist/short-drama/drama-media');
async function main() {
  const id = process.argv[2];
  if (!/^[a-f\d-]{36}$/i.test(id || '')) throw new Error('Expected a project UUID');
  const config = await loadAppConfig();
  const db = await mongoose.createConnection(config.mongodb.uri, { serverSelectionTimeoutMS: 10000 }).asPromise();
  try {
    const project = await db.collection('short_drama_projects').findOne({ id }, { projection: { _id: 0, id: 1, revision: 1, budgetLimit: 1, budgetHolds: 1 } });
    if (!project) throw new Error('Project missing');
    const results = await db.collection('short_drama_candidates').find({ projectId: id }, { projection: { id: 1, kind: 1, source: 1, status: 1, taskId: 1, archiveStatus: 1, url: 1, text: 1, createdAt: 1 } }).toArray();
    const billing = await db.collection('billing_records').find({ taskId: { $in: results.map(c => c.taskId).filter(Boolean) } }, { projection: { _id: 0, taskId: 1, status: 1, provider: 1, actualCost: 1 } }).toArray();
    const media = await Promise.all(results.filter(c => c.status === 'succeeded' && c.url).map(async c => {
      const entry = { id: c.id, kind: c.kind, source: c.source, archiveStatus: c.archiveStatus, host: new URL(c.url).hostname };
      if (process.argv.includes('--probe-sources')) {
        try { const data = await downloadDramaMedia(c.url); entry.bytes = data.length; entry.mime = dramaMediaMime(data, c.kind === 'video' || c.kind === 'export' ? 'video' : ['voice', 'music'].includes(c.kind) ? 'audio' : 'image'); }
        catch (error) { entry.readError = ['CERT_HAS_EXPIRED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code) ? error.code : 'MEDIA_READ_FAILED'; }
      }
      return entry;
    }));
    const holds = project.budgetHolds || [], used = holds.filter(h => h.settled).reduce((n,h) => n + h.amount, 0), reserved = holds.filter(h => !h.settled).reduce((n,h) => n + h.amount, 0);
    const report = { checkedAt: new Date().toISOString(), project: { id, revision: project.revision, budget: { limit: project.budgetLimit ?? 0, used, reserved, remaining: Math.max(0, (project.budgetLimit ?? 0) - used - reserved) } }, statusCounts: results.reduce((o,c) => ({ ...o, [c.status]: (o[c.status] || 0) + 1 }), {}), billing, media };
    const reportDir = path.resolve('output/short-drama-inspection');
    await fs.mkdir(reportDir, { recursive: true });
    const target = path.join(reportDir, 'runtime-evidence.json');
    const latestExport = results.filter(c => c.kind === 'export' && c.status === 'succeeded' && c.text).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    if (latestExport) await fs.writeFile(path.join(reportDir, 'latest-export.srt'), latestExport.text, 'utf8');
    await fs.writeFile(target, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await db.close(); }
}
main().catch(() => { console.error('Read-only acceptance inspection failed; no credentials were printed.'); process.exitCode = 1; });

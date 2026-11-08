/** Copy legacy objects before changing references. Source objects are never deleted. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = require('minio');
const { MongoClient } = require('mongodb');
const { BSON } = require('mongodb');
const { CopyConditions } = require('minio');
const { dpapi } = require('./migrate-modelhub-to-atlas.cjs');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
const { buildAssetStorageKey, ASSET_STORAGE_PATHS } = require('../src/common/storage/asset-storage-path.ts');

const ROOT = path.resolve(__dirname, '..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const BASE = path.join(ROOT, 'config/migration-backups');
const keyPattern = /^workflow-assets\/([a-f0-9]{64})\/([a-f0-9-]{36})\.([a-z0-9]{1,10})$/;
const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain', json: 'application/json' };
const log = value => console.log(JSON.stringify(value));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function runFolder(run) {
  assert.match(run, /^[a-zA-Z0-9_-]+$/, 'Invalid migration run name');
  return path.join(BASE, `workflow-assets_${run}`);
}

function urlFor(base, key) {
  return `${base.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function objectKeyForUrl(base, value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value), root = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.host !== root.host) return undefined;
    const prefix = root.pathname.replace(/\/+$/, '') + '/';
    return url.pathname.startsWith(prefix) ? decodeURIComponent(url.pathname.slice(prefix.length)) : undefined;
  } catch { return undefined; }
}

function choosePurpose(asset, candidates) {
  if (asset && asset.source !== 'upload' && Object.hasOwn(ASSET_STORAGE_PATHS, asset.source)) return asset.source;
  if (candidates.some(item => item.source === 'render' || item.kind === 'export')) return 'drama-render';
  if (candidates.some(item => item.source === 'model')) return 'drama-archive';
  if (candidates.some(item => item.source === 'upload')) return 'drama-upload';
  return 'upload';
}

/** Only known keys on the configured file domain are rewritten, including URLs in JSON strings. */
function stringRewriter(base, entries) {
  const root = new URL(base);
  const prefix = root.host + root.pathname.replace(/\/+$/, '') + '/';
  const pattern = new RegExp(`https?:\\/\\/${escapeRegex(prefix)}(workflow-assets\\/[a-f0-9]{64}\\/[a-f0-9-]{36}\\.[a-z0-9]{1,10})(?=$|[?#\\s"'<>\\\\,;)}\\]])`, 'gi');
  const replacements = new Map(entries.map(entry => [entry.key, urlFor(base, entry.targetKey)]));
  return value => value.replace(pattern, (original, key) => replacements.get(key) || original);
}

function referenceChanges(document, rewrite) {
  const changes = [];
  function walk(value, parts) {
    if (typeof value === 'string') {
      const after = rewrite(value);
      if (after !== value) {
        assert(parts.every(part => !part.includes('.') && !part.startsWith('$')), 'Unsafe reference field path');
        changes.push({ path: parts.join('.'), before: value, after });
      }
    } else if (Array.isArray(value)) value.forEach((item, index) => walk(item, [...parts, String(index)]));
    else if (value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
      for (const [field, item] of Object.entries(value)) if (field !== '_id') walk(item, [...parts, field]);
    }
  }
  walk(document, []);
  return changes;
}

async function collectionsToScan(db) {
  // Historical backups stay immutable. Queue telemetry has no resource URL fields.
  return (await db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name)
    .filter(name => !name.startsWith('__') && !name.startsWith('system.') && name !== 'queue_snapshots').sort();
}

async function scanReferences(ctx, entries) {
  const rewrite = stringRewriter(ctx.selected.publicBaseUrl, entries), patches = [];
  for (const name of await collectionsToScan(ctx.db)) {
    for await (const document of ctx.db.collection(name).find({}, { batchSize: 100 })) {
      const changes = referenceChanges(document, rewrite);
      if (changes.length) patches.push({ collection: name, id: document._id, changes });
    }
  }
  return patches;
}

function seal(folder, name, value, key) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const bytes = Buffer.concat([cipher.update(BSON.EJSON.stringify(value, { relaxed: false })), cipher.final()]);
  fs.writeFileSync(path.join(folder, name), bytes, { flag: 'wx' });
  return { file: name, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), sha256: sha(bytes) };
}

function unseal(folder, metadata, key) {
  const bytes = fs.readFileSync(path.join(folder, metadata.file));
  assert.equal(sha(bytes), metadata.sha256, 'Encrypted reference backup checksum mismatch');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(metadata.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(metadata.tag, 'hex'));
  return BSON.EJSON.parse(Buffer.concat([decipher.update(bytes), decipher.final()]).toString(), { relaxed: false });
}

function patchSummary(patches) {
  const result = {};
  for (const patch of patches) {
    result[patch.collection] ||= { documents: 0, fields: 0 };
    result[patch.collection].documents++;
    result[patch.collection].fields += patch.changes.length;
  }
  return result;
}

async function plan(ctx, run) {
  const folder = runFolder(run);
  assert(!fs.existsSync(folder), 'Migration plan already exists; use a new run name');
  const legacy = await objects(ctx);
  const assets = await ctx.db.collection('workflow_assets').find({}).toArray();
  const candidates = await ctx.db.collection('short_drama_candidates').find({}).toArray();
  const entries = [];
  for (const object of legacy) {
    const match = keyPattern.exec(object.key);
    assert(match, 'Unrecognized legacy object layout; no objects changed');
    const [, ownerKey, assetId, fileExt] = match;
    const asset = assets.find(item => item.id === assetId && sha(item.ownerId) === ownerKey);
    const linked = candidates.filter(item => objectKeyForUrl(ctx.selected.publicBaseUrl, item.url) === object.key || (asset && item.assetId === asset.id));
    const purpose = choosePurpose(asset, linked);
    const stat = await ctx.s3.statObject(ctx.selected.bucket, object.key);
    assert.equal(stat.size, object.size, 'Legacy object changed during inventory');
    const contentType = mimeTypes[fileExt];
    assert(contentType, 'Unknown legacy media extension');
    const targetKey = buildAssetStorageKey(ctx.selected.pathPrefix, { assetId, ownerKey, fileExt, contentType, purpose });
    entries.push({ ...object, targetKey, purpose, contentType, assetRecord: !!asset, candidateReferences: linked.length });
  }
  assert.equal(new Set(entries.map(item => item.targetKey)).size, entries.length, 'Destination collision');
  const patches = await scanReferences(ctx, entries);
  fs.mkdirSync(folder, { recursive: true });
  const backupKey = crypto.randomBytes(32);
  fs.writeFileSync(path.join(folder, 'backup-key.dpapi'), dpapi(backupKey, true), { flag: 'wx' });
  const manifest = { version: 1, run, plannedAt: new Date().toISOString(), fingerprint: ctx.fingerprint,
    provider: ctx.config.workflowAssetStorage.provider, bucket: ctx.selected.bucket, database: ctx.db.databaseName,
    objects: entries, referenceSummary: patchSummary(patches), referenceBackup: seal(folder, 'references-before.enc', patches, backupKey),
    sourceObjectsRetained: true, copied: [], appliedReferences: [] };
  save(path.join(folder, 'manifest.json'), manifest);
  const purposes = {};
  for (const entry of entries) purposes[entry.purpose] = (purposes[entry.purpose] || 0) + 1;
  log({ phase: 'plan-ready', run, objects: entries.length, bytes: entries.reduce((n, item) => n + item.size, 0),
    purposes, withoutAssetRecord: entries.filter(item => !item.assetRecord).length, references: manifest.referenceSummary,
    manifest: path.relative(ROOT, path.join(folder, 'manifest.json')), remoteWrites: false });
}

async function digestStream(stream) {
  const hash = crypto.createHash('sha256'); let size = 0;
  for await (const chunk of stream) { size += chunk.length; hash.update(chunk); }
  return { size, sha256: hash.digest('hex') };
}

async function publicDigest(url) {
  const parsed = new URL(url);
  const network = parsed.protocol === 'https:' ? require('node:https') : require('node:http');
  return new Promise((resolve, reject) => {
    const request = network.get(parsed, { timeout: 20000, headers: { 'Accept-Encoding': 'identity' } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('Public object read failed')); return; }
      digestStream(response).then(resolve, reject);
    });
    request.once('timeout', () => request.destroy(new Error('Public object read timed out')));
    request.once('error', reject);
  });
}

async function statIfPresent(ctx, key) {
  try { return await ctx.s3.statObject(ctx.selected.bucket, key); }
  catch (error) { if (['NotFound', 'NoSuchKey'].includes(error.code)) return undefined; throw error; }
}

async function copyAndVerify(ctx, entry) {
  const sourceStat = await ctx.s3.statObject(ctx.selected.bucket, entry.key);
  assert.equal(sourceStat.size, entry.size, 'Source size changed since plan');
  assert.equal(sourceStat.etag, entry.etag, 'Source checksum changed since plan');
  const source = await digestStream(await ctx.s3.getObject(ctx.selected.bucket, entry.key));
  assert.equal(source.size, entry.size, 'Source download is incomplete');
  const existing = await statIfPresent(ctx, entry.targetKey);
  if (!existing) {
    const conditions = new CopyConditions(); conditions.setMatchETag(entry.etag);
    await ctx.s3.copyObject(ctx.selected.bucket, entry.targetKey, `/${ctx.selected.bucket}/${entry.key}`, conditions);
  }
  const targetStat = await ctx.s3.statObject(ctx.selected.bucket, entry.targetKey);
  assert.equal(targetStat.size, entry.size, 'Destination size mismatch');
  assert.equal(targetStat.metaData['content-type'], sourceStat.metaData['content-type'], 'Destination MIME mismatch');
  const target = await digestStream(await ctx.s3.getObject(ctx.selected.bucket, entry.targetKey));
  assert.deepEqual(target, source, 'Copied object SHA-256 mismatch; references unchanged');
  assert.deepEqual(await publicDigest(urlFor(ctx.selected.publicBaseUrl, entry.targetKey)), source, 'Public object SHA-256 mismatch; references unchanged');
  return { key: entry.key, targetKey: entry.targetKey, ...target, verifiedAt: new Date().toISOString(), reused: !!existing };
}

async function applyReferences(db, patches) {
  const result = [];
  for (const patch of patches) {
    const collection = db.collection(patch.collection);
    const filter = { _id: patch.id }, update = {};
    for (const change of patch.changes) { filter[change.path] = change.before; update[change.path] = change.after; }
    // Compare and set only affected fields; never replace whole documents or overwrite concurrent edits.
    const changed = await collection.updateOne(filter, { $set: update });
    if (!changed.matchedCount) {
      const already = { _id: patch.id };
      for (const change of patch.changes) already[change.path] = change.after;
      assert(await collection.findOne(already, { projection: { _id: 1 } }), 'Reference changed concurrently; resume from a new scan');
    }
    result.push({ collection: patch.collection, id: String(patch.id), fields: patch.changes.length });
  }
  return result;
}

async function apply(ctx, run) {
  const folder = runFolder(run), file = path.join(folder, 'manifest.json'), manifest = read(file);
  assert.equal(manifest.fingerprint, ctx.fingerprint, 'Storage or database target changed since plan');
  const lock = path.join(folder, 'apply.lock');
  fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  try {
    const backupKey = dpapi(fs.readFileSync(path.join(folder, 'backup-key.dpapi')), false);
    const pending = manifest.objects.filter(entry => !manifest.copied.some(item => item.key === entry.key));
    for (let start = 0; start < pending.length; start += 3) {
      const results = await Promise.allSettled(pending.slice(start, start + 3).map(async entry => {
        const verified = await copyAndVerify(ctx, entry);
        manifest.copied.push(verified); save(file, manifest);
        log({ phase: 'copy-verified', completed: manifest.copied.length, total: manifest.objects.length, purpose: entry.purpose });
      }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    }
    assert.equal(manifest.copied.length, manifest.objects.length, 'All object copies must verify before references change');
    const original = unseal(folder, manifest.referenceBackup, backupKey);
    manifest.appliedReferences = await applyReferences(ctx.db, original); save(file, manifest);
    // Catch new references created while objects were being copied, using fresh backups and CAS updates.
    for (let pass = 0; pass < 3; pass++) {
      const remaining = await scanReferences(ctx, manifest.objects);
      if (!remaining.length) break;
      manifest.extraReferenceBackups ||= [];
      const backup = seal(folder, `references-extra-${manifest.extraReferenceBackups.length}.enc`, remaining, backupKey);
      manifest.extraReferenceBackups.push(backup); save(file, manifest);
      manifest.appliedReferences.push(...await applyReferences(ctx.db, remaining)); save(file, manifest);
    }
    const leftovers = await scanReferences(ctx, manifest.objects);
    assert.equal(leftovers.length, 0, 'Legacy references still exist in active collections');
    const current = await objects(ctx);
    const newObjects = current.filter(item => !manifest.objects.some(entry => entry.key === item.key));
    manifest.completedAt = new Date().toISOString(); manifest.completed = true;
    manifest.newLegacyObjects = newObjects; manifest.remainingLegacyReferences = patchSummary(leftovers);
    save(file, manifest);
    log({ phase: 'migration-complete', run, verifiedObjects: manifest.copied.length,
      bytes: manifest.copied.reduce((n, item) => n + item.size, 0), references: patchSummary(original),
      updatedDocuments: manifest.appliedReferences.length, newLegacyObjects: newObjects.length, sourceObjectsRetained: true });
  } finally { fs.unlinkSync(lock); }
}

async function verify(ctx, run) {
  const folder = runFolder(run), manifest = read(path.join(folder, 'manifest.json'));
  assert.equal(manifest.fingerprint, ctx.fingerprint, 'Storage or database target changed since plan');
  assert(manifest.completed, 'Migration has not completed');
  let verified = 0;
  for (let start = 0; start < manifest.objects.length; start += 3) {
    await Promise.all(manifest.objects.slice(start, start + 3).map(async entry => {
      const copied = manifest.copied.find(item => item.key === entry.key);
      const source = await ctx.s3.statObject(ctx.selected.bucket, entry.key);
      assert.equal(source.etag, entry.etag, 'Original object changed after migration');
      assert.equal(source.size, entry.size, 'Original object size changed');
      const target = await digestStream(await ctx.s3.getObject(ctx.selected.bucket, entry.targetKey));
      assert.deepEqual(target, { size: copied.size, sha256: copied.sha256 }, 'Destination checksum changed after migration');
      assert.deepEqual(await publicDigest(urlFor(ctx.selected.publicBaseUrl, entry.targetKey)), target, 'Public URL verification failed');
      verified++;
    }));
  }
  const remaining = await scanReferences(ctx, manifest.objects);
  assert.equal(remaining.length, 0, 'Old references found after migration');
  const current = await objects(ctx);
  const newLegacyObjects = current.filter(item => !manifest.objects.some(entry => entry.key === item.key));
  const result = { phase: 'verification-complete', run, verifiedAt: new Date().toISOString(), verifiedObjects: verified,
    bytes: manifest.copied.reduce((n, entry) => n + entry.size, 0), updatedDocuments: manifest.appliedReferences.length,
    updatedFields: manifest.appliedReferences.reduce((n, item) => n + item.fields, 0), remainingOldReferenceDocuments: remaining.length,
    newLegacyObjects: newLegacyObjects.length, sourceObjectsRetained: true, originalObjectsPresent: current.length };
  save(path.join(folder, 'verification.json'), result); log(result);
}

async function loadConfig() {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  if (['true', '1', 'yes'].includes((process.env.NACOS_ENABLE || '').toLowerCase())) {
    const { NacosConfigClient } = require('nacos');
    const client = new NacosConfigClient({ serverAddr: process.env.NACOS_SERVER_ADDR,
      namespace: process.env.NACOS_NAMESPACE || undefined, username: process.env.NACOS_USERNAME || undefined,
      password: process.env.NACOS_PASSWORD || undefined });
    try {
      await client.ready();
      const value = await client.getConfig(process.env.NACOS_DATA_ID || 'model-hub', process.env.NACOS_GROUP || 'DEFAULT_GROUP');
      assert(value, 'Nacos configuration is empty');
      return JSON.parse(value);
    } finally { if (typeof client.close === 'function') client.close(); }
  }
  return JSON.parse(fs.readFileSync(path.join(ROOT, `config/${process.env.NODE_ENV || 'development'}.json`), 'utf8'));
}

async function connect() {
  const config = await loadConfig();
  const storage = config.workflowAssetStorage;
  assert(['minio', 'datacapsule', 'qiniu'].includes(storage?.provider), 'An S3 storage provider is required');
  const selected = storage[storage.provider];
  assert(selected?.bucket && selected?.publicBaseUrl && config.mongodb?.uri, 'Storage or database configuration missing');
  assert(selected.useSSL || selected.allowInsecureHttp === true, 'HTTP uploads require explicit configuration');
  const s3 = new Client({ endPoint: selected.endPoint, port: selected.port, useSSL: selected.useSSL,
    region: selected.region, accessKey: selected.accessKeyId, secretKey: selected.secretAccessKey, pathStyle: true });
  s3.setRequestOptions({ timeout: 20000 });
  const mongo = new MongoClient(config.mongodb.uri, { serverSelectionTimeoutMS: 15000, socketTimeoutMS: 120000 });
  try {
    await mongo.connect();
    const db = mongo.db();
    return { config, selected, s3, mongo, db,
      fingerprint: sha(JSON.stringify([selected.endPoint, selected.bucket, selected.publicBaseUrl, config.mongodb.uri])) };
  } catch (error) { await mongo.close(); throw error; }
}

async function objects(ctx) {
  const result = [];
  for await (const object of ctx.s3.listObjectsV2(ctx.selected.bucket, 'workflow-assets/', true)) {
    if (!object.name?.endsWith('/')) result.push({ key: object.name, size: object.size, etag: object.etag });
  }
  return result.sort((a, b) => a.key.localeCompare(b.key));
}

async function main() {
  const mode = process.argv[2] || 'inventory';
  assert(['inventory', 'plan', 'apply', 'verify'].includes(mode), 'Unknown migration mode');
  const ctx = await connect();
  try {
    if (mode === 'plan') return await plan(ctx, process.argv[3]);
    if (mode === 'apply') return await apply(ctx, process.argv[3]);
    if (mode === 'verify') return await verify(ctx, process.argv[3]);
    const legacy = await objects(ctx);
    const collections = [];
    for (const entry of await ctx.db.listCollections({}, { nameOnly: true }).toArray()) {
      if (entry.name.startsWith('__') || entry.name.startsWith('system.')) continue;
      collections.push({ name: entry.name, count: await ctx.db.collection(entry.name).estimatedDocumentCount() });
    }
    console.log(JSON.stringify({ mode, provider: ctx.config.workflowAssetStorage.provider, bucket: ctx.selected.bucket,
      database: ctx.db.databaseName, objects: legacy.length, bytes: legacy.reduce((n, item) => n + item.size, 0),
      extensions: [...new Set(legacy.map(item => path.extname(item.key)))], collections }, null, 2));
  } finally { await ctx.mongo.close(); }
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ status: 'failed', name: error.name, code: error.code || error.cause?.code,
    message: error instanceof assert.AssertionError ? error.message : 'Migration failed; connection credentials and provider response suppressed' }));
  process.exitCode = 1;
});

module.exports = { sha, save, loadConfig, connect, objects, choosePurpose, stringRewriter, referenceChanges,
  objectKeyForUrl, applyReferences, digestStream, urlFor, copyAndVerify, plan, apply };

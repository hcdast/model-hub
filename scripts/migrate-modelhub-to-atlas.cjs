/** Isolated database migration. No overwrites, deletions, or paid model requests. */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { MongoClient, BSON } = require('mongodb');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'config/development.json');
const BASE = path.join(ROOT, 'config/migration-backups');
const EVIDENCE = path.join(BASE, 'latest-verification.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const json = async (p, value) => fsp.writeFile(p, JSON.stringify(value, null, 2) + '\n');
const load = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const safeName = s => { assert.match(s, /^[a-zA-Z0-9_-]+$/); return s; };

function dpapi(bytes, protect) {
  assert.equal(process.platform, 'win32', 'Backup key protection requires Windows DPAPI');
  const method = protect ? 'Protect' : 'Unprotect';
  const ps = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::${method}($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser))`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { input: bytes.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(r.status, 0, 'DPAPI operation failed; credentials suppressed');
  return Buffer.from(r.stdout.trim(), 'base64');
}

async function* bsonFrames(chunks) {
  let remaining = Buffer.alloc(0);
  for await (const chunk of chunks) {
    remaining = remaining.length ? Buffer.concat([remaining, chunk]) : chunk;
    let offset = 0;
    while (remaining.length - offset >= 4) {
      const size = remaining.readInt32LE(offset);
      assert(size >= 5 && size <= 16 * 1024 * 1024, 'Invalid BSON frame size');
      if (remaining.length - offset < size) break;
      const frame = remaining.subarray(offset, offset + size);
      assert.equal(frame[frame.length - 1], 0, 'Invalid BSON terminator');
      yield frame;
      offset += size;
    }
    remaining = remaining.subarray(offset);
  }
  assert.equal(remaining.length, 0, 'Truncated BSON backup');
}

function patchedConfig(raw, oldUri, newUri) {
  const before = JSON.parse(raw);
  assert.equal(before.mongodb.uri, oldUri, 'Connection changed since migration began');
  const literal = JSON.stringify(oldUri);
  assert.equal(raw.split(literal).length, 2, 'Expected a unique URI occurrence');
  const result = raw.replace(literal, JSON.stringify(newUri));
  const expected = structuredClone(before);
  expected.mongodb.uri = newUri;
  assert.deepEqual(JSON.parse(result), expected, 'Unexpected config mutation');
  return result;
}

async function signature(collection, filter = {}) {
  const hash = crypto.createHash('sha256');
  let count = 0;
  for await (const raw of collection.find(filter, { raw: true, sort: { _id: 1 }, hint: '_id_', batchSize: 20000 })) {
    assert(Buffer.isBuffer(raw)); hash.update(raw); count++;
  }
  return { count, sha256: hash.digest('hex') };
}

async function inventory(db) {
  const entries = (await db.listCollections({}, { nameOnly: false }).toArray()).sort((a, b) => a.name.localeCompare(b.name));
  const result = [];
  for (const col of entries) {
    safeName(col.name);
    assert.equal(col.type, 'collection', 'Views require an explicit migration plan');
    assert.equal(Object.keys(col.options || {}).length, 0, 'Special collections require an explicit migration plan');
    result.push({ name: col.name, options: col.options || {}, indexes: await db.collection(col.name).indexes() });
  }
  return result;
}

async function backupCollection(db, entry, folder, key) {
  const file = `${safeName(entry.name)}.bson.gz.enc`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const hash = crypto.createHash('sha256');
  let count = 0, bytes = 0;
  async function* documents() {
    for await (const raw of db.collection(entry.name).find({}, { raw: true, sort: { _id: 1 }, hint: '_id_', batchSize: 20000 })) {
      assert(Buffer.isBuffer(raw)); hash.update(raw); count++; bytes += raw.length; yield raw;
      if (count % 100000 === 0) console.log(JSON.stringify({ phase: 'backup', collection: entry.name, count }));
    }
  }
  await pipeline(Readable.from(documents()), zlib.createGzip(), cipher, fs.createWriteStream(path.join(folder, file), { flags: 'wx' }));
  return { ...entry, file, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), count, bytes, sha256: hash.digest('hex') };
}

async function* restoreFrames(folder, entry, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(entry.tag, 'hex'));
  const output = zlib.createGunzip();
  const pump = pipeline(fs.createReadStream(path.join(folder, entry.file)), decipher, output);
  // Observe pipeline rejection immediately, then propagate it to the consumer below.
  pump.catch(() => {});
  try { yield* bsonFrames(output); await pump; }
  finally { output.destroy(); await pump; }
}

async function validateBackup(folder, entry, key) {
  const hash = crypto.createHash('sha256'); let count = 0;
  for await (const raw of restoreFrames(folder, entry, key)) { hash.update(raw); count++; }
  assert.equal(count, entry.count, 'Backup document count mismatch');
  assert.equal(hash.digest('hex'), entry.sha256, 'Backup checksum mismatch');
}

function telemetryCutoff(entry, now = Date.now()) {
  if (entry.name !== 'queue_snapshots') return null;
  const ttl = entry.indexes.find(i => i.expireAfterSeconds === 604800 && Object.keys(i.key).length === 1 && i.key.timestamp === 1 && !i.partialFilterExpression);
  // Only telemetry gets a TTL allowance. Financial, model and user records remain exact.
  return ttl ? new Date(now + 10 * 60000 - ttl.expireAfterSeconds * 1000) : null;
}

async function assertUnchanged(db, entries, telemetryBackup) {
  assert.deepEqual((await inventory(db)).map(c => c.name), entries.map(c => c.name));
  for (const entry of entries) {
    const cutoff = telemetryBackup && telemetryCutoff(entry);
    if (cutoff) {
      const hash = crypto.createHash('sha256'); let count = 0;
      for await (const raw of restoreFrames(telemetryBackup.folder, entry, telemetryBackup.key)) {
        const row = BSON.deserialize(raw);
        assert(row.timestamp instanceof Date, 'Unsupported telemetry TTL field');
        if (row.timestamp >= cutoff) { hash.update(raw); count++; }
      }
      assert.deepEqual(await signature(db.collection(entry.name), { timestamp: { $gte: cutoff } }),
        { count, sha256: hash.digest('hex') }, 'Non-expired telemetry changed');
      continue;
    }
    const actual = await signature(db.collection(entry.name));
    assert.deepEqual(actual, { count: entry.count, sha256: entry.sha256 }, `Database changed: ${entry.name}`);
  }
}

function client(uri) { return new MongoClient(uri, { compressors: ['zlib'], zlibCompressionLevel: 6, serverSelectionTimeoutMS: 10000, connectTimeoutMS: 8000, socketTimeoutMS: 120000 }); }
async function connect(cfg) {
  assert(cfg.mongodb.uri1, 'Original connection uri1 is required');
  assert.notEqual(cfg.mongodb.uri, cfg.mongodb.uri1);
  assert.equal(new URL(cfg.mongodb.uri).protocol, 'mongodb+srv:', 'Target must be configured Atlas SRV connection');
  const source = client(cfg.mongodb.uri1), target = client(cfg.mongodb.uri);
  try { await source.connect(); await target.connect(); return { source, target }; }
  catch (e) { await Promise.allSettled([source.close(), target.close()]); throw e; }
}

async function backup(run) {
  safeName(run);
  const folder = path.join(BASE, run);
  const cfg = load(CONFIG), originalConfig = fs.readFileSync(CONFIG);
  const { source, target } = await connect(cfg);
  try {
    const hello = await target.db().admin().command({ hello: 1 });
    assert(hello.setName && hello.logicalSessionTimeoutMinutes != null);
    const destination = `modelhub_migrated_${run}`;
    assert(destination.length < 64);
    assert.equal((await target.db(destination).listCollections().toArray()).length, 0, 'Destination already exists');
    await fsp.mkdir(BASE, { recursive: true });
    await fsp.mkdir(folder); // Never reuse an incomplete or existing run.
    const key = crypto.randomBytes(32);
    await fsp.writeFile(path.join(folder, 'backup-key.dpapi'), dpapi(key, true), { flag: 'wx' });
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    await fsp.writeFile(path.join(folder, 'config-before.enc'), Buffer.concat([cipher.update(originalConfig), cipher.final()]));
    const manifest = { run, createdAt: new Date().toISOString(), destination, sourceDatabase: source.db().databaseName,
      originalTargetDatabase: target.db().databaseName, targetHostHash: sha(new URL(cfg.mongodb.uri).hostname),
      originalConfigHash: sha(originalConfig), configBackup: { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') }, databases: {} };
    for (const [role, db] of [['target', target.db()], ['source', source.db()]]) {
      const sub = path.join(folder, role); await fsp.mkdir(sub);
      const entries = []; manifest.databases[role] = entries;
      for (const entry of await inventory(db)) {
        const completed = await backupCollection(db, entry, sub, key);
        await validateBackup(sub, completed, key); entries.push(completed);
        await json(path.join(folder, 'manifest.json'), manifest);
        console.log(JSON.stringify({ phase: 'backup-verified', role, collection: entry.name, count: completed.count }));
      }
      await assertUnchanged(db, entries, role === 'source' ? { folder: sub, key } : undefined);
    }
    manifest.backupVerified = true;
    await json(path.join(folder, 'manifest.json'), manifest);
    console.log(JSON.stringify({ phase: 'backup-complete', run, destination, sourceDocuments: manifest.databases.source.reduce((a, c) => a + c.count, 0) }));
  } finally { await Promise.all([source.close(), target.close()]); }
}

async function copy(run) {
  const folder = path.join(BASE, safeName(run)), m = load(path.join(folder, 'manifest.json'));
  assert(m.backupVerified && !m.copyVerified, 'Run must have a verified backup and no completed copy');
  const cfg = load(CONFIG); assert.equal(sha(fs.readFileSync(CONFIG)), m.originalConfigHash);
  assert.equal(sha(new URL(cfg.mongodb.uri).hostname), m.targetHostHash);
  const key = dpapi(fs.readFileSync(path.join(folder, 'backup-key.dpapi')), false);
  const { source, target } = await connect(cfg);
  try {
    const db = target.db(m.destination);
    assert.equal((await db.listCollections().toArray()).length, 0, 'Destination must be empty');
    const sourceBackup = { folder: path.join(folder, 'source'), key };
    await assertUnchanged(source.db(), m.databases.source, sourceBackup);
    for (const entry of m.databases.source) {
      await db.createCollection(entry.name, entry.options);
      let batch = [], copied = 0;
      async function flush() { if (!batch.length) return; await db.collection(entry.name).insertMany(batch, { ordered: true, writeConcern: { w: 'majority' } }); copied += batch.length; batch = []; }
      for await (const raw of restoreFrames(path.join(folder, 'source'), entry, key)) {
        batch.push(BSON.deserialize(raw, { promoteValues: false, promoteLongs: false, promoteBuffers: false }));
        if (batch.length === 10000) { await flush(); if (copied % 100000 === 0) console.log(JSON.stringify({ phase: 'copy', collection: entry.name, copied })); }
      }
      await flush();
      assert.deepEqual(await signature(db.collection(entry.name)), { count: entry.count, sha256: entry.sha256 }, `Copy verification failed: ${entry.name}`);
      console.log(JSON.stringify({ phase: 'copy-verified', collection: entry.name, count: copied }));
    }
    await assertUnchanged(source.db(), m.databases.source, sourceBackup);
    // Defer TTL activation until final cutover to preserve the verified copy during validation.
    for (const entry of m.databases.source) {
      const indexes = entry.indexes.filter(i => i.name !== '_id_' && i.expireAfterSeconds === undefined).map(({ v, ns, background, ...rest }) => rest);
      if (indexes.length) await db.collection(entry.name).createIndexes(indexes);
      const actual = await db.collection(entry.name).indexes();
      const normalize = values => values.map(({ v, ns, background, ...rest }) => rest).sort((a,b) => a.name.localeCompare(b.name));
      assert.deepEqual(normalize(actual), normalize(entry.indexes.filter(i => i.expireAfterSeconds === undefined)), `Index verification failed: ${entry.name}`);
    }
    m.copyVerified = true; m.copyCompletedAt = new Date().toISOString();
    await json(path.join(folder, 'manifest.json'), m);
    await json(EVIDENCE, { run, destination: m.destination, completedAt: m.copyCompletedAt, status: 'copied-and-verified',
      encryptedBackups: true, backupKeyProtection: 'Windows DPAPI CurrentUser', originalDatabasesPreserved: true,
      sourceConsistencyVerified: true, telemetrySourceConsistency: 'retention-aware; records near 7-day TTL expiry excluded from source drift check only',
      bsonChecksumsVerified: true, indexesVerified: false, nonTtlIndexesVerified: true, ttlActivationPending: true, switched: false,
      collections: m.databases.source.map(e => ({ name: e.name, count: e.count, bytes: e.bytes, sha256: e.sha256, indexCount: e.indexes.length })) });
    console.log(JSON.stringify({ phase: 'copy-complete', destination: m.destination, collections: m.databases.source.length }));
  } finally { await Promise.all([source.close(), target.close()]); }
}

async function switchDatabase(run) {
  const folder = path.join(BASE, safeName(run)), m = load(path.join(folder, 'manifest.json'));
  assert(m.copyVerified && !m.switched);
  const raw = fs.readFileSync(CONFIG, 'utf8'); assert.equal(sha(Buffer.from(raw)), m.originalConfigHash);
  const cfg = JSON.parse(raw), { source, target } = await connect(cfg);
  try {
    const key = dpapi(fs.readFileSync(path.join(folder, 'backup-key.dpapi')), false);
    await assertUnchanged(source.db(), m.databases.source, { folder: path.join(folder, 'source'), key });
    await assertUnchanged(target.db(m.destination), m.databases.source);
    for (const entry of m.databases.source) {
      const indexes = entry.indexes.filter(i => i.expireAfterSeconds !== undefined).map(({ v, ns, background, ...rest }) => rest);
      if (indexes.length) await target.db(m.destination).collection(entry.name).createIndexes(indexes);
      const normalize = values => values.map(({ v, ns, background, ...rest }) => rest).sort((a,b) => a.name.localeCompare(b.name));
      assert.deepEqual(normalize(await target.db(m.destination).collection(entry.name).indexes()), normalize(entry.indexes), `Final index verification failed: ${entry.name}`);
    }
    const u = new URL(cfg.mongodb.uri); u.pathname = '/' + m.destination;
    const next = patchedConfig(raw, cfg.mongodb.uri, u.href);
    const temp = CONFIG + '.migration-' + safeName(run) + '.tmp';
    await fsp.writeFile(temp, next, { flag: 'wx' });
    assert.equal(sha(fs.readFileSync(CONFIG)), m.originalConfigHash, 'Config changed during final verification');
    await fsp.rename(temp, CONFIG);
    m.switched = true; m.switchedAt = new Date().toISOString();
    await json(path.join(folder, 'manifest.json'), m);
    const evidence = load(EVIDENCE); evidence.switched = true; evidence.switchedAt = m.switchedAt; evidence.status = 'switched';
    evidence.indexesVerified = true; evidence.ttlActivationPending = false;
    evidence.retention = 'Original TTL indexes restored after full BSON verification; expired telemetry may naturally be removed.';
    await json(EVIDENCE, evidence);
    console.log(JSON.stringify({ phase: 'switch-complete', database: m.destination, originalDatabasesPreserved: true }));
  } finally { await Promise.all([source.close(), target.close()]); }
}

module.exports = { bsonFrames, patchedConfig, telemetryCutoff, dpapi, backupCollection, validateBackup, signature, inventory, assertUnchanged };
if (require.main === module) {
  const [mode, run] = process.argv.slice(2);
  const action = { backup, copy, switch: switchDatabase }[mode];
  if (!action || !run) { console.error('Usage: node scripts/migrate-modelhub-to-atlas.cjs backup|copy|switch RUN'); process.exitCode = 1; }
  else action(run).catch(error => { console.error(JSON.stringify({ failed: true, name: error.name, code: error.code,
    message: error.name === 'AssertionError' ? error.message : 'Migration failed; credentials suppressed. Original databases preserved.' })); process.exitCode = 1; });
}

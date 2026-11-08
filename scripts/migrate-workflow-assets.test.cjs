const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createServer } = require('node:http');
const { ObjectId } = require('mongodb');
const { choosePurpose, stringRewriter, referenceChanges, objectKeyForUrl, applyReferences, copyAndVerify, sha } = require('./migrate-workflow-assets.cjs');

const key = `workflow-assets/${'a'.repeat(64)}/12345678-1234-1234-1234-123456789abc.mp4`;
const targetKey = key.replace('workflow-assets', 'modelhub/short-drama/renders/video');
const base = 'https://cdn.example.com/files';
const before = `${base}/${key}`, after = `${base}/${targetKey}`;

test('classifies explicit sources and recovers legacy short drama purposes from candidates', () => {
  assert.equal(choosePurpose({ source: 'drama-archive' }, [{ source: 'render' }]), 'drama-archive');
  assert.equal(choosePurpose({ source: 'output-text' }, []), 'output-text');
  assert.equal(choosePurpose({ source: 'upload' }, [{ kind: 'export', source: 'render' }]), 'drama-render');
  assert.equal(choosePurpose({ source: 'upload' }, [{ kind: 'video', source: 'model' }]), 'drama-archive');
  assert.equal(choosePurpose({ source: 'upload' }, [{ kind: 'image', source: 'upload' }]), 'drama-upload');
  assert.equal(choosePurpose(undefined, []), 'upload');
});

test('matches configured domain and full object path, preserving URL suffixes and JSON strings', () => {
  const rewrite = stringRewriter(base, [{ key, targetKey }]);
  assert.equal(rewrite(before), after);
  assert.equal(rewrite(before.replace('https:', 'http:')), after);
  assert.equal(rewrite(`${before}?download=1#media`), `${after}?download=1#media`);
  assert.equal(rewrite(JSON.stringify({ url: before, array: [before] })), JSON.stringify({ url: after, array: [after] }));
  for (const value of [before + '.backup', before + '/extra', before.replace('cdn.example.com', 'other.example.com'), before.replace('/files/', '/different/'), key]) {
    assert.equal(rewrite(value), value);
  }
  assert.equal(objectKeyForUrl(base, before), key);
  assert.equal(objectKeyForUrl(base, before.replace('cdn.example.com', 'other.example.com')), undefined);
});

test('collects nested URL leaves without modifying BSON identities, dates or unrelated data', () => {
  const id = new ObjectId(), date = new Date(), bytes = Buffer.from('private');
  const doc = { _id: id, nested: { outputs: [{ url: before, text: 'unchanged' }] }, date, bytes, count: 42 };
  const changes = referenceChanges(doc, stringRewriter(base, [{ key, targetKey }]));
  assert.deepEqual(changes, [{ path: 'nested.outputs.0.url', before, after }]);
  assert.equal(doc.nested.outputs[0].url, before);
  assert.equal(doc._id, id); assert.equal(doc.date, date); assert.equal(doc.bytes, bytes);
});

test('CAS reference updates use only affected fields and resume already migrated documents', async () => {
  const operations = [];
  const db = { collection: name => ({
    updateOne: async (filter, update) => { operations.push({ name, filter, update }); return { matchedCount: 0 }; },
    findOne: async filter => filter.url === after ? { _id: 1 } : null,
  }) };
  const patches = [{ collection: 'workflow_assets', id: 1, changes: [{ path: 'url', before, after }] }];
  await applyReferences(db, patches);
  assert.deepEqual(operations, [{ name: 'workflow_assets', filter: { _id: 1, url: before }, update: { $set: { url: after } } }]);
  const conflict = { collection: () => ({ updateOne: async () => ({ matchedCount: 0 }), findOne: async () => null }) };
  await assert.rejects(applyReferences(conflict, patches), /changed concurrently/);
});

test('copy verifies both S3 bytes and public reads, and never overwrites an occupied destination', async () => {
  const bytes = Buffer.from('movie data'), stored = new Map([[key, bytes]]), copied = [];
  const server = createServer((req, res) => { res.end(stored.get(req.url.slice(1)) || 'missing'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const publicBaseUrl = `http://127.0.0.1:${server.address().port}`;
  const ctx = { selected: { bucket: 'test-bucket', publicBaseUrl }, s3: {
    statObject: async (_bucket, name) => {
      const value = stored.get(name);
      if (!value) throw Object.assign(new Error('missing'), { code: 'NotFound' });
      return { size: value.length, etag: 'source-etag', metaData: { 'content-type': 'video/mp4' } };
    },
    getObject: async (_bucket, name) => Readable.from([stored.get(name)]),
    copyObject: async (_bucket, destination, source, conditions) => {
      assert.equal(source, `/test-bucket/${key}`); assert.equal(conditions.matchETag, 'source-etag');
      assert(!stored.has(destination)); stored.set(destination, bytes); copied.push(destination);
    },
  } };
  const entry = { key, targetKey, size: bytes.length, etag: 'source-etag' };
  try {
    const first = await copyAndVerify(ctx, entry);
    assert.equal(first.sha256, sha(bytes)); assert.equal(first.reused, false); assert.deepEqual(copied, [targetKey]);
    assert.equal((await copyAndVerify(ctx, entry)).reused, true); assert.equal(copied.length, 1);
    stored.set(targetKey, Buffer.from('bad content'));
    await assert.rejects(copyAndVerify(ctx, entry), /mismatch/);
    assert.equal(copied.length, 1); assert.equal(stored.get(key), bytes);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

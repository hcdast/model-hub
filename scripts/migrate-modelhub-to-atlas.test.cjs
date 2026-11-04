const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BSON } = require('mongodb');
const { bsonFrames, patchedConfig, telemetryCutoff } = require('./migrate-modelhub-to-atlas.cjs');

test('BSON framing preserves document boundaries and exact numeric types', async () => {
  const docs = [
    { _id: new BSON.ObjectId(), large: BSON.Long.fromString('9007199254740993'), decimal: BSON.Decimal128.fromString('12.345'),
      int: new BSON.Int32(42), double: new BSON.Double(42), negativeZero: new BSON.Double(-0), date: new Date(1700000000000), binary: new BSON.Binary(Buffer.from([0,255,7]), 0) },
    { _id: 'next', unicode: '原验收配音', nested: { enabled: true }, tags: ['one', 'two'] },
  ];
  const raw = docs.map(d => BSON.serialize(d)), all = Buffer.concat(raw);
  const chunks = []; for (let i=0; i<all.length; i+=3) chunks.push(all.subarray(i,i+3));
  const actual = []; for await (const frame of bsonFrames(chunks)) actual.push(frame);
  assert.deepEqual(actual, raw);
  for (const frame of actual) assert.deepEqual(BSON.serialize(BSON.deserialize(frame, { promoteValues: false, promoteLongs: false, promoteBuffers: false })), frame);
});

test('BSON framing rejects truncated or corrupt backups', async () => {
  const raw = BSON.serialize({ _id: 'a' });
  async function consume(chunks) { for await (const _ of bsonFrames(chunks)) {} }
  await assert.rejects(consume([raw.subarray(0,raw.length-1)]), /Truncated/);
  const bad = Buffer.from(raw); bad[bad.length-1]=1;
  await assert.rejects(consume([bad]), /terminator/);
  const length = Buffer.alloc(4); length.writeInt32LE(32*1024*1024);
  await assert.rejects(consume([length]), /frame size/);
});

test('cutover changes only the intended Mongo URI and preserves formatting', () => {
  const raw = '{\r\n  "mongodb": {"uri1":"original", "uri":"atlas", "maxPoolSize":20},\r\n  "provider":{"api_key":"unchanged"}\r\n}\r\n';
  assert.equal(patchedConfig(raw, 'atlas', 'new-atlas'), raw.replace('"atlas"','"new-atlas"'));
  assert.throws(() => patchedConfig(raw, 'other', 'new'), /Connection changed/);
  assert.throws(() => patchedConfig('{"mongodb":{"uri":"atlas"},"other":"atlas"}', 'atlas', 'new'), /unique/);
});

test('TTL allowance is restricted to the original seven-day queue telemetry policy', () => {
  const entry = {name:'queue_snapshots', indexes:[{key:{timestamp:1},expireAfterSeconds:604800}]};
  const now=Date.UTC(2026,10,3,15);
  assert.equal(telemetryCutoff(entry,now).getTime(),now+600000-604800000);
  assert.equal(telemetryCutoff({...entry,name:'wallets'},now),null);
  assert.equal(telemetryCutoff({...entry,indexes:[{key:{timestamp:1},expireAfterSeconds:604800,partialFilterExpression:{type:'x'}}]},now),null);
});

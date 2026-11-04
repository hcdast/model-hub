/** User-requested synchronization into Atlas modelhub. Keeps prior data as backup collections. */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const { dpapi, backupCollection, validateBackup, signature, inventory, assertUnchanged, patchedConfig, telemetryCutoff } = require('./migrate-modelhub-to-atlas.cjs');
const ROOT = path.resolve(__dirname, '..'), CONFIG = path.join(ROOT, 'config/development.json');
const BASE = path.join(ROOT, 'config/migration-backups');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const load = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (p, v) => fsp.writeFile(p, JSON.stringify(v, null, 2) + '\n');
const normalizedIndexes = xs => xs.map(({v,ns,background,...x})=>x).sort((a,b)=>a.name.localeCompare(b.name));

function collectionNames(run, name) {
  assert.match(run, /^\d{8}_\d{2}$/);
  assert.match(name, /^[a-zA-Z0-9_-]+$/);
  assert(!name.startsWith('__'), 'Unexpected source collection');
  return { temp: `__sync_${run}_${name}`, backup: `__before_sync_${run}_${name}` };
}

async function existingCollections(db,names) {
  const wanted=new Set(names);
  // Atlas tiers may reject $in in listCollections filters. Filter names locally.
  return (await db.listCollections({}, {nameOnly:true}).toArray()).filter(x=>wanted.has(x.name));
}

async function runSync(run) {
  collectionNames(run,'probe');
  const folder = path.join(BASE, `sync_${run}`), manifestPath = path.join(folder,'manifest.json');
  const configBytes = fs.readFileSync(CONFIG), cfg = JSON.parse(configBytes);
  const migration = load(path.join(BASE,'20261103_03/manifest.json'));
  const sourceName = new URL(cfg.mongodb.uri).pathname.slice(1), targetName='modelhub';
  assert.equal(sourceName,migration.destination,'Current connection must be the verified migration database');
  assert(migration.copyVerified && migration.switched);
  assert.notEqual(sourceName,targetName);
  const c = new MongoClient(cfg.mongodb.uri,{compressors:['zlib'],zlibCompressionLevel:6,serverSelectionTimeoutMS:10000,socketTimeoutMS:120000});
  await c.connect();
  try {
    const source=c.db(sourceName),target=c.db(targetName);
    const originalKey=dpapi(fs.readFileSync(path.join(BASE,'20261103_03/backup-key.dpapi')),false);
    let m,key;
    if(fs.existsSync(manifestPath)) {
      m=load(manifestPath); assert.equal(m.configHash,sha(configBytes));
      assert.equal(m.source,sourceName); assert.equal(m.target,targetName);
      assert(!m.completed,'Synchronization already completed');
      key=dpapi(fs.readFileSync(path.join(folder,'backup-key.dpapi')),false);
    } else {
      await fsp.mkdir(folder);
      key=crypto.randomBytes(32); await fsp.writeFile(path.join(folder,'backup-key.dpapi'),dpapi(key,true),{flag:'wx'});
      const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
      await fsp.writeFile(path.join(folder,'config-before.enc'),Buffer.concat([cipher.update(configBytes),cipher.final()]));
      m={run,startedAt:new Date().toISOString(),source:sourceName,target:targetName,configHash:sha(configBytes),
        configBackup:{iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex')},backups:[],staged:[],promotions:[]};
      await save(manifestPath,m);
    }
    const reference=migration.databases.source;
    if(!m.backupVerified) {
      assert.equal(m.backups.length,0,'Interrupted backup requires a fresh RUN; no target collections changed');
      const current=await inventory(target), allowed=new Set(reference.map(x=>x.name));
      assert(current.every(x=>allowed.has(x.name)),'Unexpected target collections; explicit review required');
      for(const e of current) {
        const names=collectionNames(run,e.name);
        assert.equal((await existingCollections(target,[names.temp,names.backup])).length,0,'Temporary namespace collision');
        const b=await backupCollection(target,e,folder,key); await validateBackup(folder,b,key);
        m.backups.push(b);await save(manifestPath,m);
        console.log(JSON.stringify({phase:'target-backup-verified',collection:e.name,count:b.count}));
      }
      await assertUnchanged(target,m.backups);m.backupVerified=true;await save(manifestPath,m);
    }
    if(!m.stagingVerified) {
      await assertUnchanged(source,reference,{folder:path.join(BASE,'20261103_03/source'),key:originalKey});
      for(const entry of reference) {
        if(m.staged.some(x=>x.name===entry.name))continue;
        const names=collectionNames(run,entry.name);
        assert.equal((await existingCollections(target,[names.temp])).length,0,'Untracked temporary collection; review before resuming');
        await source.collection(entry.name).aggregate([{$out:{db:targetName,coll:names.temp}}],
          {readConcern:{level:'majority'},writeConcern:{w:'majority'},maxTimeMS:300000}).toArray();
        const indexes=entry.indexes.filter(i=>i.name!=='_id_'&&i.expireAfterSeconds===undefined).map(({v,ns,background,...x})=>x);
        if(indexes.length)await target.collection(names.temp).createIndexes(indexes);
        const actual=await signature(target.collection(names.temp));
        const cutoff=telemetryCutoff(entry);
        if(cutoff) {
          const filter={timestamp:{$gte:cutoff}};
          assert.deepEqual(await signature(target.collection(names.temp),filter),await signature(source.collection(entry.name),filter),'Retained telemetry mismatch');
        } else assert.deepEqual(actual,{count:entry.count,sha256:entry.sha256},`BSON mismatch: ${entry.name}`);
        assert.deepEqual(normalizedIndexes(await target.collection(names.temp).indexes()),normalizedIndexes(entry.indexes.filter(i=>i.expireAfterSeconds===undefined)));
        m.staged.push({name:entry.name,...names,...actual,indexes:entry.indexes});await save(manifestPath,m);
        console.log(JSON.stringify({phase:'modelhub-staged-verified',collection:entry.name,count:actual.count}));
      }
      m.stagingVerified=true;await save(manifestPath,m);
    }
    if(!m.promotionStarted) {
      // Target names are unchanged until all staging copies have been verified.
      for(const old of m.backups)assert.deepEqual(await signature(target.collection(old.name)),{count:old.count,sha256:old.sha256},`Target changed: ${old.name}`);
      assert.equal(sha(fs.readFileSync(CONFIG)),m.configHash,'Concurrent configuration change');
      m.promotionStarted=true;await save(manifestPath,m);
    }
    for(const staged of m.staged) {
      let state=m.promotions.find(x=>x.name===staged.name);
      if(!state){state={name:staged.name,oldPresent:m.backups.some(x=>x.name===staged.name),oldSaved:false,promoted:false};m.promotions.push(state);await save(manifestPath,m);}
      if(state.oldPresent&&!state.oldSaved) {
        const existing=await existingCollections(target,[staged.name,staged.backup]);
        if(existing.some(x=>x.name===staged.name)) {
          assert(!existing.some(x=>x.name===staged.backup),'Backup name collision');
          await target.collection(staged.name).rename(staged.backup,{dropTarget:false});
        } else assert(existing.some(x=>x.name===staged.backup),'Original and backup both missing');
        state.oldSaved=true;await save(manifestPath,m);
      }
      if(!state.promoted) {
        const existing=await existingCollections(target,[staged.name,staged.temp]);
        if(existing.some(x=>x.name===staged.temp)) {
          assert(!existing.some(x=>x.name===staged.name),'Target unexpectedly occupied');
          await target.collection(staged.temp).rename(staged.name,{dropTarget:false});
        } else assert.deepEqual(await signature(target.collection(staged.name)),{count:staged.count,sha256:staged.sha256},'Untracked promoted collection mismatch');
        state.promoted=true;await save(manifestPath,m);
      }
      assert.deepEqual(await signature(target.collection(staged.name)),{count:staged.count,sha256:staged.sha256},`Promoted BSON mismatch: ${staged.name}`);
    }
    for(const staged of m.staged) {
      const indexes=staged.indexes.filter(i=>i.expireAfterSeconds!==undefined).map(({v,ns,background,...x})=>x);
      if(indexes.length)await target.collection(staged.name).createIndexes(indexes);
      assert.deepEqual(normalizedIndexes(await target.collection(staged.name).indexes()),normalizedIndexes(staged.indexes),`Index mismatch: ${staged.name}`);
    }
    assert.equal(sha(fs.readFileSync(CONFIG)),m.configHash,'Configuration changed before final cutover');
    const uri=new URL(cfg.mongodb.uri);uri.pathname='/modelhub';
    const next=patchedConfig(configBytes.toString('utf8'),cfg.mongodb.uri,uri.href),temp=CONFIG+`.sync-${run}.tmp`;
    await fsp.writeFile(temp,next,{flag:'wx'});assert.equal(sha(fs.readFileSync(CONFIG)),m.configHash);await fsp.rename(temp,CONFIG);
    m.completed=true;m.completedAt=new Date().toISOString();await save(manifestPath,m);
    const report={run,status:'synchronized-to-modelhub',database:targetName,sourceDatabase:sourceName,completedAt:m.completedAt,
      sourceOriginalPreserved:true,targetPriorDataBackedUp:true,backupCollectionPrefix:`__before_sync_${run}_`,
      bsonChecksumsVerified:true,indexesVerified:true,connectionSwitched:true,paidGenerationCalls:0,
      collections:m.staged.map(({name,count,sha256})=>({name,count,sha256})),retention:'Original TTL restored after verification; expired telemetry naturally removed'};
    await save(path.join(BASE,'latest-verification.json'),report);
    console.log(JSON.stringify({phase:'modelhub-sync-complete',database:targetName,collections:m.staged.length,copiedDocuments:m.staged.reduce((a,x)=>a+x.count,0)}));
  } finally {await c.close();}
}

module.exports={collectionNames,existingCollections};
if(require.main===module)runSync(process.argv[2]).catch(e=>{console.error(JSON.stringify({failed:true,name:e.name,code:e.code,message:e.name==='AssertionError'?e.message:'Synchronization stopped; backups preserved. Credentials suppressed.'}));process.exitCode=1;});

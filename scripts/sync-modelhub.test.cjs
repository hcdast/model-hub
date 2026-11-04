const {test}=require('node:test');
const assert=require('node:assert/strict');
const {collectionNames,existingCollections}=require('./sync-modelhub.cjs');
test('sync staging and prior-data backups have distinct scoped names',()=>{
  assert.deepEqual(collectionNames('20261103_04','wallets'),{
    temp:'__sync_20261103_04_wallets',backup:'__before_sync_20261103_04_wallets'});
});
test('Atlas collection checks avoid unsupported server-side name operators',async()=>{
  const db={listCollections(filter,options){assert.deepEqual(filter,{});assert.deepEqual(options,{nameOnly:true});return{async toArray(){return[{name:'wallets'},{name:'__backup_wallets'},{name:'tasks'}];}};}};
  assert.deepEqual(await existingCollections(db,['wallets','__backup_wallets']),[{name:'wallets'},{name:'__backup_wallets'}]);
});
test('sync refuses namespace injection and reserved source collections',()=>{
  for(const [run,name]of [['../run','wallets'],['20261103_04','a.b'],['20261103_04','__private'],['20261103_04','a/b']])
    assert.throws(()=>collectionNames(run,name));
});

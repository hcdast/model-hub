#!/usr/bin/env node
// Preview by default. Reads local configuration without logging database credentials.
require('ts-node/register/transpile-only');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { prepareModel, TYPES } = require('../src/admin/utils/legacy-model-import');
const { mediaConstraintBackfill } = require('../src/admin/utils/media-constraint-backfill');
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
async function main() {
  if (!args.includes('--source')) throw new Error('Required: --source <model-config-export.json> [--config config/development.json] [--apply]');
  const config = JSON.parse(fs.readFileSync(args.includes('--config') ? value('--config') : path.join(__dirname, '../config/development.json'), 'utf8'));
  const source = JSON.parse(fs.readFileSync(value('--source'), 'utf8').replace(/^\uFEFF/, '')).items;
  const selected = source.filter(m => m.provider === 'maas' && TYPES[m.model_type]);
  const db = await mongoose.createConnection(config.mongodb.uri).asPromise();
  try {
    const collection = db.collection('model_configs'), plan = [];
    for (const raw of selected) {
      const matches = await collection.find({ provider: 'akool-maas', provider_model_name: raw.model_name, model_type: TYPES[raw.model_type] }).toArray();
      if (matches.length !== 1) throw new Error(`Expected one current model for ${raw.model_name}/${TYPES[raw.model_type]}, found ${matches.length}`);
      const before = matches[0];
      const set = mediaConstraintBackfill(before, prepareModel(raw, before).doc);
      if (Object.keys(set).length) plan.push({ before, set });
    }
    console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'preview', selected: selected.length, updates: plan.length, fields: plan.reduce((n, p) => n + Object.keys(p.set).length, 0) }));
    if (args.includes('--apply') && plan.length) {
      const folder = path.join(__dirname, '../logs'); fs.mkdirSync(folder, { recursive: true });
      const backup = path.join(folder, `media-constraints-${Date.now()}.json`);
      fs.writeFileSync(backup, JSON.stringify(plan.map(p => ({ _id: p.before._id, revision: p.before.revision, params: p.before.params, params_rules: p.before.params_rules })), null, 2), { flag: 'wx' });
      let applied = 0;
      for (const { before, set } of plan) {
        const filter = { _id: before._id, revision: before.revision === undefined ? { $exists: false } : before.revision, params: before.params };
        filter.params_rules = before.params_rules === undefined ? { $exists: false } : before.params_rules;
        const result = await collection.updateOne(filter, { $set: { ...set, updatedAt: new Date() }, $inc: { revision: 1 } });
        if (result.modifiedCount !== 1) throw new Error(`Concurrent edit detected for ${before.model_id}; stopped after ${applied} updates. Backup: ${backup}`);
        applied++;
      }
      console.log(JSON.stringify({ applied, backup }));
    }
  } finally { await db.close(); }
}
main().catch(error => { console.error(error.name === 'MongoServerSelectionError' ? 'Database connection failed; inspect local configuration.' : error.message); process.exitCode = 1; });

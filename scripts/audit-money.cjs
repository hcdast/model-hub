require('ts-node/register/transpile-only');
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const { loadAppConfig } = require('../src/config/nacos-config.loader');
const { reconcileMoney } = require('../src/billing/reconciliation');
(async () => {
  const config = await loadAppConfig(), db = await mongoose.createConnection(config.mongodb.uri, { serverSelectionTimeoutMS: 10000 }).asPromise();
  try {
    const maxRows = 100001;
    const [wallets, transactions, bills, tasks] = await Promise.all([
      db.collection('wallets').find({}, { projection: { apiKey: 1, clientId: 1, balance: 1, frozenAmount: 1, reservations: 1 } }).limit(maxRows).toArray(),
      db.collection('wallet_transactions').find({}, { projection: { apiKey: 1, clientId: 1, type: 1, amount: 1, balanceBefore: 1, balanceAfter: 1, relatedTaskId: 1 } }).sort({ createdAt: 1, _id: 1 }).limit(maxRows).toArray(),
      db.collection('billing_records').find({}, { projection: { apiKey: 1, clientId: 1, taskId: 1, billingPolicy: 1, status: 1, estimatedCost: 1, actualCost: 1, reservationTracked: 1 } }).limit(maxRows).toArray(),
      db.collection('tasks').find({}, { projection: { taskId: 1, status: 1, createdAt: 1, updatedAt: 1 } }).limit(maxRows).toArray(),
    ]);
    if ([wallets, transactions, bills, tasks].some(rows => rows.length === maxRows)) throw new Error('Audit exceeds 100000 rows; use a streaming offline audit. No complete result was generated.');
    const report = reconcileMoney(wallets, transactions, bills, tasks);
    const index = process.argv.indexOf('--output');
    const output = index >= 0 ? path.resolve(process.argv[index + 1]) : path.join(__dirname, `../output/verification/admin-money-audit-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ readOnly: true, scanned: report.scanned, counts: report.counts, output }));
  } finally { await db.close(); }
  process.exit(0);
})().catch(() => { console.error('Read-only audit failed. Inspect database availability and audit limits; no money changes were made.'); process.exit(1); });

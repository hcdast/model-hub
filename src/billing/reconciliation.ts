import { createHash } from 'crypto';

/** Read-only audit: findings are evidence to investigate, never an automatic refund instruction. */
export function reconcileMoney(wallets: any[], transactions: any[], bills: any[], tasks: any[]) {
  const issues: Array<{ kind: string; walletId?: string; taskId?: string; detail: string }> = [];
  const taskById = new Map(tasks.map(t => [t.taskId, t]));
  const key = (row: any) => row.apiKey || row.clientId;
  const group = (rows: any[], getKey: (row: any) => string) => {
    const result = new Map<string, any[]>();
    for (const row of rows) { const id = getKey(row); const list = result.get(id) || []; list.push(row); result.set(id, list); }
    return result;
  };
  const ledgerByClient = group(transactions, key), billsByClient = group(bills, key);
  const debitKey = (row: any, taskId: string) => JSON.stringify([key(row), taskId]);
  const debitsByTask = group(transactions.filter(t => t.type === 'debit'), row => debitKey(row, row.relatedTaskId));
  for (const wallet of wallets) {
    const walletId = String(wallet._id), rows = ledgerByClient.get(key(wallet)) || [];
    let previous: number | undefined;
    for (const row of rows) {
      const delta = row.type === 'credit' ? row.amount : row.type === 'debit' ? -row.amount : 0;
      if (![row.amount, row.balanceBefore, row.balanceAfter].every(Number.isFinite) || Math.abs(row.balanceAfter - row.balanceBefore - delta) > 1e-6) issues.push({ kind: 'ledger_arithmetic', walletId, taskId: row.relatedTaskId, detail: '流水金额与前后余额不一致' });
      if (previous !== undefined && Math.abs(row.balanceBefore - previous) > 1e-6) issues.push({ kind: 'ledger_chain', walletId, taskId: row.relatedTaskId, detail: '相邻流水余额不连续；需核对旧记录和同时间戳顺序' });
      previous = row.balanceAfter;
    }
    if (previous !== undefined && Math.abs(wallet.balance - previous) > 1e-6) issues.push({ kind: 'wallet_balance', walletId, detail: '钱包余额与最新流水不一致' });
    if (!Number.isFinite(wallet.balance) || !Number.isFinite(wallet.frozenAmount) || wallet.balance < -1e-6 || wallet.frozenAmount < -1e-6 || wallet.frozenAmount > wallet.balance + 1e-6) issues.push({ kind: 'wallet_bounds', walletId, detail: '钱包余额或冻结额越界' });
    const pending = (billsByClient.get(key(wallet)) || []).filter(b => b.billingPolicy === 'internal' && b.status === 'pre_deducted');
    const expected = pending.reduce((sum, b) => sum + b.estimatedCost, 0);
    if (Math.abs(expected - wallet.frozenAmount) > 1e-6) issues.push({ kind: 'frozen_bills', walletId, detail: `待结算账单冻结合计 ${expected} 与钱包冻结 ${wallet.frozenAmount} 不同` });
    for (const bill of pending.filter(b => b.reservationTracked)) {
      const reservation = createHash('sha256').update(bill.taskId).digest('hex');
      if (wallet.reservations?.[reservation] !== bill.estimatedCost) issues.push({ kind: 'reservation_missing', walletId, taskId: bill.taskId, detail: '已跟踪预扣账单没有匹配的任务冻结凭证' });
    }
  }
  for (const bill of bills) {
    const task = taskById.get(bill.taskId);
    if (!task && ['estimated', 'pre_deducted'].includes(bill.status)) issues.push({ kind: 'bill_without_task', taskId: bill.taskId, detail: '待结算账单没有对应任务' });
    if (task && ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'].includes(task.status) && ['estimated', 'pre_deducted'].includes(bill.status)) issues.push({ kind: 'terminal_unsettled', taskId: bill.taskId, detail: `任务 ${task.status}，账单仍为 ${bill.status}` });
    if (task && ['PENDING', 'RUNNING', 'SUBMITTED', 'PROCESSING'].includes(task.status) && Date.now() - new Date(task.updatedAt || task.createdAt).getTime() > 86400000) issues.push({ kind: 'stale_task', taskId: bill.taskId, detail: '任务超过 24 小时未更新；需核对供应商实际状态' });
    if (bill.billingPolicy === 'internal' && bill.status === 'settled') {
      const debits = debitsByTask.get(debitKey(bill, bill.taskId)) || [];
      if (debits.length !== 1 || Math.abs((debits[0]?.amount ?? 0) - bill.actualCost) > 1e-6) issues.push({ kind: 'settled_debit', taskId: bill.taskId, detail: '已结算内部账单未匹配唯一且金额一致的扣费流水' });
    }
  }
  const counts: Record<string, number> = {};
  for (const issue of issues) counts[issue.kind] = (counts[issue.kind] || 0) + 1;
  return { checkedAt: new Date().toISOString(), readOnly: true, consistency: 'best_effort_non_snapshot',
    limitations: ['Concurrent writes can cause transient findings; rerun during a quiet window.', 'Same-timestamp legacy ledger ordering needs manual verification.'],
    scanned: { wallets: wallets.length, transactions: transactions.length, bills: bills.length, tasks: tasks.length }, counts, issues };
}

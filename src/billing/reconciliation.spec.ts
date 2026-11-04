import { reconcileMoney } from './reconciliation';
it('matches a coherent balance, reservation, settlement and debit without changes', () => {
  const result = reconcileMoney([{ _id: 'w', apiKey: 'key', balance: 90, frozenAmount: 0 }], [{ apiKey: 'key', relatedTaskId: 't', type: 'debit', amount: 10, balanceBefore: 100, balanceAfter: 90 }], [{ apiKey: 'key', taskId: 't', billingPolicy: 'internal', status: 'settled', actualCost: 10 }], [{ taskId: 't', status: 'SUCCESS' }]);
  expect(result.issues).toEqual([]); expect(JSON.stringify(result)).not.toContain('key');
});
it('surfaces missing ledger and terminal frozen bills instead of issuing refunds', () => {
  const result = reconcileMoney([{ _id: 'w', apiKey: 'key', balance: 100, frozenAmount: 10 }], [], [{ apiKey: 'key', taskId: 't', billingPolicy: 'internal', status: 'pre_deducted', estimatedCost: 10, reservationTracked: true }, { apiKey: 'key', taskId: 'settled', billingPolicy: 'internal', status: 'settled', actualCost: 5 }], [{ taskId: 't', status: 'FAILED' }]);
  expect(result.counts).toMatchObject({ terminal_unsettled: 1, reservation_missing: 1, settled_debit: 1 }); expect(result.readOnly).toBe(true);
});

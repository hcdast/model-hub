import { AsyncLocalStorage } from 'async_hooks';
import { ClientSession, Connection } from 'mongoose';
import { ServiceUnavailableException } from '@nestjs/common';

interface MoneyTransaction { connection: Connection; session: ClientSession; afterCommit: Array<() => void> }
const storage = new AsyncLocalStorage<MoneyTransaction>();
export const moneyOptions = (): { session?: ClientSession } => ({ ...(storage.getStore() ? { session: storage.getStore()!.session } : {}) });
export function afterMoneyCommit(effect: () => void) {
  const current = storage.getStore();
  if (current) current.afterCommit.push(effect); else effect();
}

/** No non-transactional fallback: a standalone Mongo must be upgraded before money writes. */
export async function moneyTransaction<T>(connection: Connection, work: () => Promise<T>): Promise<T> {
  const current = storage.getStore();
  if (current) {
    if (current.connection !== connection) throw new Error('Money writes must share one MongoDB connection');
    return work();
  }
  const session = await connection.startSession();
  let effects: Array<() => void> = [];
  try {
    const result = await session.withTransaction(async () => {
      effects = []; // MongoDB may rerun the whole callback after a write conflict.
      return storage.run({ connection, session, afterCommit: effects }, work);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 15000 });
    for (const effect of effects) { try { effect(); } catch { /* Notifications cannot undo a committed financial write. */ } }
    return result as T;
  } catch (error: any) {
    if (error.code === 20 || error.codeName === 'IllegalOperation') throw new ServiceUnavailableException('资金写入需要 MongoDB 副本集或分片集群；当前数据库不支持事务');
    throw error;
  } finally { await session.endSession(); }
}

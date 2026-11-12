import { Model, Types } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import { redactAdminData } from './redact-admin-data';

export function maskAdminKey(value?: string): string {
  return value ? `****${value.slice(-4)}` : '';
}

export async function withClientDisplay<T extends { apiKey?: string }>(model: Model<any>, rows: T[]) {
  const keys = [...new Set(rows.map(row => row.apiKey || (row as any).clientId).filter(Boolean))];
  const clients = keys.length ? await model.find({ apiKey: { $in: keys } }).select('apiKey name').lean() : [];
  const byKey = new Map(clients.map((c: any) => [c.apiKey, c]));
  const portalKeys = keys.length ? await model.db.collection('portal_api_keys').find({ billingKey: { $in: keys } }, { projection: { billingKey: 1, name: 1, userId: 1 } }).toArray() : [];
  const byPortalKey = new Map(portalKeys.map(key => [key.billingKey, key]));
  const portalIds = [...keys.filter(key => key!.startsWith('portal:')).map(key => key!.slice(7)), ...portalKeys.map(key => key.userId)];
  const objectIds = portalIds.filter(Types.ObjectId.isValid).map(id => new Types.ObjectId(id));
  const users = keys.length ? await model.db.collection('portal_users').find({ $or: [{ _id: { $in: objectIds } }, { executionBillingKey: { $in: keys } }] }, { projection: { username: 1, executionBillingKey: 1 } }).toArray() : [];
  const names = new Map(users.map(user => [String(user._id), user.username]));
  const accounts = new Map(users.filter(user => user.executionBillingKey).map(user => [user.executionBillingKey, user]));
  return rows.map(row => {
    const { clientId: legacyId, ...unredacted } = row as any;
    const safe = redactAdminData(unredacted);
    const key = row.apiKey || legacyId || '';
    if (safe.callback) { safe.callback = { ...safe.callback }; delete safe.callback.secret; }
    const client = byKey.get(key) as any;
    const portalKey = byPortalKey.get(key);
    const account = accounts.get(key);
    const portal = key.startsWith('portal:');
    return { ...safe, apiKey: maskAdminKey(key), clientRef: account ? `portal:${account._id}` : portalKey ? `portal-key:${portalKey._id}` : client ? `client:${client._id}` : portal ? key : null,
      clientName: account ? `${account.username || 'Portal 用户'} / 网页创作` : portalKey ? `${names.get(portalKey.userId) || 'Portal 用户'} / ${portalKey.name}` : client?.name || (portal ? names.get(key.slice(7)) || `Portal 用户（${key.slice(-6)}）` : '历史客户端') };
  });
}

/** Resolve non-secret admin references; legacy raw keys remain accepted as input. */
export async function resolveAdminClientKey(model: Model<any>, reference?: string): Promise<string | undefined> {
  if (!reference) return undefined;
  if (reference.startsWith('portal:') && Types.ObjectId.isValid(reference.slice(7))) {
    const account = await model.db.collection('portal_users').findOne({ _id: new Types.ObjectId(reference.slice(7)) }, { projection: { executionBillingKey: 1 } });
    return account?.executionBillingKey || reference;
  }
  if (reference.startsWith('portal-key:')) {
    const id = reference.slice(11);
    const row = Types.ObjectId.isValid(id) ? await model.db.collection('portal_api_keys').findOne({ _id: new Types.ObjectId(id) }, { projection: { billingKey: 1 } }) : null;
    if (!row) throw new NotFoundException('Portal 应用不存在');
    return row.billingKey;
  }
  if (reference.startsWith('client:')) {
    const id = reference.slice(7);
    const row: any = Types.ObjectId.isValid(id) ? await model.findById(id).select('apiKey').lean() : null;
    if (!row) throw new NotFoundException('客户端不存在');
    return row.apiKey;
  }
  if (reference.startsWith('wallet:')) {
    const id = reference.slice(7);
    const row = Types.ObjectId.isValid(id) ? await model.db.collection('wallets').findOne({ _id: new Types.ObjectId(id) }) : null;
    if (!row) throw new NotFoundException('钱包不存在');
    return row.apiKey || row.clientId;
  }
  return reference;
}

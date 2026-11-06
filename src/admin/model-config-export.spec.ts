import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection, Schema } from 'mongoose';
import { AdminModelConfigController } from './admin-model-config.controller';

describe('Model export fixed record set', () => {
  let mongo: MongoMemoryServer, db: Connection, models: any, controller: AdminModelConfigController;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' } });
    db = await createConnection(mongo.getUri()).asPromise();
    models = db.model('export_models', new Schema({}, { strict: false }));
    controller = new AdminModelConfigController(models, {} as any);
  }, 60000);
  afterAll(async () => { await db?.close(); await mongo?.stop(); });
  beforeEach(async () => {
    await models.deleteMany({});
    await models.insertMany(Array.from({ length: 125 }, (_, i) => ({ model_id: `voice-${i}`, model_name: '语音', model_type: 'tts', provider: 'fixture', revision: 1, update_time: i, disabled: i === 124, history: ['must not export'] })));
  });
  it('exports all filtered records once, without pagination or private version history', async () => {
    const { data } = await controller.exportModels({ provider: 'fixture', model_type: 'tts', status: 'enabled', keyword: 'voice-' });
    expect(data.total).toBe(124);
    expect(new Set(data.items.map((r: any) => r.model_id)).size).toBe(124);
    expect(data.items.every((r: any) => !('history' in r) && !('_id' in r))).toBe(true);
    expect((await controller.exportModels({ keyword: 'does-not-exist' })).data.items).toEqual([]);
  });
  it.each(['update', 'delete'])('refuses a partial or stale export when a selected record changes: %s', async action => {
    const original = models.find.bind(models);
    const spy = jest.spyOn(models, 'find').mockImplementation((filter: any) => {
      const query = original(filter);
      if (filter._id?.$in) {
        const lean = query.lean.bind(query);
        query.lean = async () => {
          const id = filter._id.$in[0];
          if (action === 'delete') await models.deleteOne({ _id: id });
          else await models.updateOne({ _id: id }, { $inc: { revision: 1 }, $set: { update_time: 99999 } });
          return lean();
        };
      }
      return query;
    });
    try { await expect(controller.exportModels({})).rejects.toThrow('导出期间配置已变化'); }
    finally { spy.mockRestore(); }
  });
  it('ignores new insertions after choosing the export set', async () => {
    const original = models.find.bind(models);
    const spy = jest.spyOn(models, 'find').mockImplementation((filter: any) => {
      const query = original(filter);
      if (filter._id?.$in) {
        const lean = query.lean.bind(query);
        query.lean = async () => { await models.create({ model_id: 'new-arrival', revision: 1 }); return lean(); };
      }
      return query;
    });
    try {
      const { data } = await controller.exportModels({});
      expect(data.total).toBe(125); expect(data.items.some((r: any) => r.model_id === 'new-arrival')).toBe(false);
    } finally { spy.mockRestore(); }
  });
  it('rejects an oversized export before fetching the bodies', async () => {
    const lean = jest.fn().mockResolvedValue(Array.from({ length: 10001 }, (_, _id) => ({ _id })));
    const query: any = { select: () => query, sort: () => query, limit: () => query, maxTimeMS: () => query, lean };
    const model: any = { find: jest.fn(() => query) };
    await expect(new AdminModelConfigController(model, {} as any).exportModels({})).rejects.toThrow('10000');
    expect(model.find).toHaveBeenCalledTimes(1);
  });
});

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, Connection } from 'mongoose';
import { validate } from 'class-validator';
import { ApiClientService } from '../api-client/api-client.service';
import { ApiClientSchema } from '../database/schemas/api-client.schema';
import { AdminApiClientController } from './admin-api-client.controller';
import { UpdateRateLimitsDto } from './dto/update-rate-limits.dto';
import { UpdateModelAllowlistDto } from './dto/update-model-allowlist.dto';

describe('Admin client revision safety on MongoDB', () => {
  let mongo: MongoMemoryServer, db: Connection, model: any, service: ApiClientService, controller: AdminApiClientController;
  const apiKey = 'mh_fixture_private_credential';
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' } });
    db = await createConnection(mongo.getUri()).asPromise();
    model = db.model('ApiClientRevisionTest', ApiClientSchema);
    await model.init(); service = new ApiClientService(model);
    controller = new AdminApiClientController(service, {} as any, {} as any, {} as any);
  }, 60000);
  afterAll(async () => { await db?.close(); await mongo?.stop(); });
  beforeEach(async () => { await model.deleteMany({}); await model.create({ apiKey, secretHash: 'unusable-test-hash' }); });

  it('allows exactly one writer using the same observed revision', async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => service.updateDefaultPriority(apiKey, i, 0)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.every(result => result.reason instanceof ConflictException)).toBe(true);
    expect((await model.findOne({ apiKey })).revision).toBe(1);
  });
  it('preserves the winning config, and permits a deliberate save with the fresh revision', async () => {
    await service.updateModelAllowlist(apiKey, ['provider/new'], 0);
    await expect(service.updateModelAllowlist(apiKey, ['stale/*'], 0)).rejects.toBeInstanceOf(ConflictException);
    expect((await model.findOne({ apiKey })).modelAllowlist).toEqual(['provider/new']);
    await service.updateBillingPolicy(apiKey, 'external', 1);
    await service.updateRateLimits(apiKey, { maxQps: 20 }, 2);
    await service.setEnabled(apiKey, false, 3);
    expect(await model.findOne({ apiKey }).lean()).toMatchObject({ revision: 4, enabled: false, billingPolicy: 'external', rateLimits: { maxQps: 20 } });
  });
  it('handles legacy documents with no revision atomically as revision zero', async () => {
    await model.collection.updateOne({ apiKey }, { $unset: { revision: '' } });
    const id = String((await model.findOne({ apiKey }))._id);
    expect((await service.getForAdmin(id)).revision).toBe(0);
    await service.updateBillingPolicy(apiKey, 'exempt', 0);
    await expect(service.updateBillingPolicy(apiKey, 'internal', 0)).rejects.toBeInstanceOf(ConflictException);
  });
  it('requires an observed revision on every admin configuration write', async () => {
    const id = String((await model.findOne({ apiKey }))._id);
    await expect(controller.patchEnabled(id, { enabled: false })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.updateDefaultPriority(id, { defaultPriority: 5 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.updateBillingPolicy(id, { billingPolicy: 'exempt' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.updateRateLimits(id, { maxQps: 2 } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.updateModelAllowlist(id, { modelAllowlist: [] } as any)).rejects.toBeInstanceOf(BadRequestException);
    for (const expected_revision of [-1, 0.5, null, '0']) expect(() => service.assertExpectedRevision(expected_revision)).toThrow(BadRequestException);
    expect((await model.findOne({ apiKey })).revision).toBe(0);
  });
  it('keeps revision in validated DTOs and returns only masked management data', async () => {
    for (const dto of [Object.assign(new UpdateRateLimitsDto(), { maxQps: 2, expected_revision: 0 }), Object.assign(new UpdateModelAllowlistDto(), { modelAllowlist: [], expected_revision: 0 })]) {
      expect(await validate(dto, { whitelist: true })).toEqual([]);
      expect(dto.expected_revision).toBe(0);
    }
    const id = String((await model.findOne({ apiKey }))._id);
    const detail = await controller.getDetail(id), list = await service.list(1, 20);
    expect(detail.data.revision).toBe(0); expect(list.items[0].revision).toBe(0);
    expect(JSON.stringify(detail)).not.toContain(apiKey);
    expect(JSON.stringify(detail)).not.toContain('secretHash');
    await expect(service.updateBillingPolicy('missing', 'exempt', 0)).rejects.toBeInstanceOf(NotFoundException);
  });
});

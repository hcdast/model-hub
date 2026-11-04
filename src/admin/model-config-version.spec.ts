import { BadRequestException, ConflictException } from '@nestjs/common';
import { ModelConfigService } from './model-config.service';

describe('Model configuration publication', () => {
  const active = { _id: '507f1f77bcf86cd799439011', model_id: 'test/model', model_type: 'textToImage', provider: 'wavespeed-ai', model_name: 'Test', revision: 2,
    unit_price_map: { default: { unit_credit: 1, sale_unit_price: 1, cost_unit_price: 0 } }, params: {} };
  const db: any = { findById: jest.fn(), findOneAndUpdate: jest.fn(), findOne: jest.fn() };
  const service = new ModelConfigService(db);
  beforeEach(() => { jest.clearAllMocks(); db.findById.mockReturnValue({ lean: async () => active }); db.findOneAndUpdate.mockResolvedValue(active); });
  it('stages a validated draft without overwriting active fields', async () => {
    await service.saveDraft(active._id, { model_name: 'Draft', history: ['forged'], revision: 999 }, 2);
    const [filter, update] = db.findOneAndUpdate.mock.calls[0];
    expect(filter.$and[0]).toEqual({ _id: active._id, revision: 2 });
    expect(update.$set.draft.model_name).toBe('Draft');
    expect(update.$set.model_name).toBeUndefined();
    expect(update.$set.draft.history).toBeUndefined();
    expect(update.$set.draft.revision).toBeUndefined();
  });
  it('rejects stale revisions and invalid contracts before writes', async () => {
    await expect(service.saveDraft(active._id, {}, 1)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.saveDraft(active._id, { params: { n: { type: 'integer', required: false, default: 2.5 } } }, 2)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('publishes atomically with bounded history and drops draft', async () => {
    db.findById.mockReturnValue({ lean: async () => ({ ...active, draft: { ...active, model_name: 'Published' } }) });
    await service.publish(active._id, 2);
    const [filter, update] = db.findOneAndUpdate.mock.calls[0];
    expect(filter.$and[0].revision).toBe(2); expect(update.$inc.revision).toBe(1);
    expect(update.$set.model_name).toBe('Published'); expect(update.$unset.draft).toBe(1);
    expect(update.$push.history.$slice).toBe(-20);
  });
  it('rolls back complete snapshots including removing newly added optional fields', async () => {
    db.findById.mockReturnValue({ lean: async () => ({ ...active, docs: { sections: [] }, history: [{ config: { ...active, model_name: 'Previous' } }] }) });
    await service.publish(active._id, 2, true);
    const update = db.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.model_name).toBe('Previous'); expect(update.$unset.docs).toBe(1);
  });
  it('reports concurrent changes instead of falsely reporting publication success', async () => {
    db.findById.mockReturnValue({ lean: async () => ({ ...active, draft: active }) }); db.findOneAndUpdate.mockResolvedValue(null);
    await expect(service.publish(active._id, 2)).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects stale draft revisions even when the active revision has not changed', async () => {
    db.findById.mockReturnValue({ lean: async () => ({ ...active, draft_revision: 4, draft: active }) });
    await expect(service.saveDraft(active._id, {}, 2, 3)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.publish(active._id, 2, false, 3)).rejects.toBeInstanceOf(ConflictException);
    expect(db.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

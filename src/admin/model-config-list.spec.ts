import { AdminModelConfigController } from './admin-model-config.controller';

describe('Model list update-time ordering', () => {
  let query: any, db: any, controller: AdminModelConfigController;
  beforeEach(() => {
    query = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) };
    db = { find: jest.fn(() => query), countDocuments: jest.fn().mockResolvedValue(42) };
    controller = new AdminModelConfigController(db, {} as any);
  });
  it('defaults to latest update first and provides deterministic tie-breakers before pagination', async () => {
    const result = await controller.list();
    expect(query.sort).toHaveBeenCalledWith({ update_time: -1, model_id: 1, _id: 1 });
    expect(query.sort.mock.invocationCallOrder[0]).toBeLessThan(query.skip.mock.invocationCallOrder[0]);
    expect(query.skip).toHaveBeenCalledWith(0);
    expect(query.limit).toHaveBeenCalledWith(20);
    expect(result.data.total).toBe(42);
  });
  it.each([['asc', 1], ['desc', -1], ['unexpected', -1]] as const)('orders by update_time for %s while preserving filters and pagination', async (order, direction) => {
    await controller.list('akool-openapi', 'tts', 'voice', 'enabled', undefined, '3', '10', order);
    expect(query.sort).toHaveBeenCalledWith({ update_time: direction, model_id: 1, _id: 1 });
    expect(query.skip).toHaveBeenCalledWith(20);
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(db.find).toHaveBeenCalledWith(expect.objectContaining({ provider: 'akool-openapi', model_type: 'tts', disabled: { $ne: true } }));
    expect(db.countDocuments).toHaveBeenCalledWith(db.find.mock.calls[0][0]);
  });
});

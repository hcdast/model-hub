import { TaskService } from './task.service';
import { MediaInputValidatorService } from '../metadata/media-input-validator.service';
import { writeFile } from 'fs/promises';

it('rejects noncompliant actual media before reserving money, creating a task or queueing', async () => {
  const validator: any = new MediaInputValidatorService();
  validator.download = (_url: string, file: string) => writeFile(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  const service: any = Object.create(TaskService.prototype);
  const cfg = { model_id: 'demo/image-to-image', model_type: 'imageToImage', provider: 'akool-maas', params: { image: { type: 'string', required: true, media: { kind: 'image', resolution: { min: 240 } } } } };
  Object.assign(service, {
    logger: { log: jest.fn() },
    providerRouting: { tryResolveFromRules: async () => null }, providerRegistry: { hasAdapter: () => true },
    modelConfigModel: { find: () => ({ sort: () => ({ lean: async () => [cfg] }) }) },
    providerConfig: { getResolved: async () => ({ enabled: true }) }, mediaValidator: validator,
    billingAdapter: { initBilling: jest.fn() }, queueRouter: { enqueue: jest.fn() }, taskRepo: { create: jest.fn() },
  });
  await expect(service.createTask('test-client', { model: cfg.model_id, input: { image: 'https://example.com/claimed-4k.png' }, options: { featureType: 'imageToImage' } })).rejects.toThrow('媒体校验失败');
  expect(service.billingAdapter.initBilling).not.toHaveBeenCalled();
  expect(service.taskRepo.create).not.toHaveBeenCalled();
  expect(service.queueRouter.enqueue).not.toHaveBeenCalled();
});

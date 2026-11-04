import { ShortDramaRenderService } from './drama-render.service';
import { emptyDramaPlan } from './drama.types';
import { randomUUID } from 'crypto';

describe('Short drama export preflight', () => {
  function setup() {
    const plan = { ...emptyDramaPlan(), story: '故事', storyConfirmed: true, castConfirmed: true, storyboardConfirmed: true, characters: [{ id: 'girl', name: '女孩', description: '短发' }],
      shots: [{ id: 'shot1', title: '相遇', description: '推门', narration: '你好', duration: 5, characterIds: ['girl'], image: 'image1', video: 'video1' }] };
    const projects = { findOne: jest.fn().mockReturnValue({ lean: async () => ({ id: 'project', ownerId: 'owner', revision: 2, plan }) }) };
    const candidates = { findOne: jest.fn().mockReturnValue({ lean: async () => null }), find: jest.fn().mockReturnValue({ lean: async () => [{ id: 'image1', kind: 'image', targetId: 'shot1', status: 'succeeded', url: 'https://media.example/i.jpg' }, { id: 'video1', kind: 'video', targetId: 'shot1', status: 'succeeded', url: 'https://media.example/v.mp4' }] }), updateOne: jest.fn() };
    const queue = { add: jest.fn() }, service = new ShortDramaRenderService(projects as any, candidates as any, queue as any, {} as any);
    jest.spyOn(service, 'capabilities').mockResolvedValue({ mp4: true, subtitles: true, reason: '' });
    return { service, projects, candidates, queue, plan };
  }
  it('blocks unavailable encoders or fonts before queueing an export', async () => {
    const h = setup(); jest.mocked(h.service.capabilities).mockResolvedValue({ mp4: false, subtitles: false, reason: '缺少 FFmpeg' });
    await expect(h.service.start('owner', 'project', 2, randomUUID())).rejects.toThrow('缺少 FFmpeg'); expect(h.queue.add).not.toHaveBeenCalled();
    jest.mocked(h.service.capabilities).mockResolvedValue({ mp4: true, subtitles: false, reason: '缺少中文字体' });
    await expect(h.service.start('owner', 'project', 2, randomUUID())).rejects.toThrow('缺少中文字体'); expect(h.queue.add).not.toHaveBeenCalled();
  });
  it('queues a frozen plan using the explicit request id and rejects stale revisions', async () => {
    const h = setup(), requestId = randomUUID(); await expect(h.service.start('owner', 'project', 1, requestId)).rejects.toThrow('作品已更新');
    await h.service.start('owner', 'project', 2, requestId);
    expect(h.queue.add).toHaveBeenCalledWith(expect.objectContaining({ candidateId: requestId, ownerId: 'owner', plan: h.plan }), expect.objectContaining({ jobId: requestId, attempts: 1 }));
    h.candidates.findOne.mockReturnValue({ lean: async () => ({ id: requestId, status: 'running' } as any) });
    await h.service.start('owner', 'project', 2, requestId); expect(h.queue.add).toHaveBeenCalledTimes(1);
  });
  it('re-enqueues a pending render after a failed queue submission', async () => {
    const h = setup(), requestId = randomUUID(); h.queue.add.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(h.service.start('owner', 'project', 2, requestId)).rejects.toThrow('redis unavailable');
    h.candidates.findOne.mockReturnValueOnce({ lean: async () => ({ id: requestId, status: 'pending' } as any) });
    await h.service.start('owner', 'project', 2, requestId); expect(h.queue.add).toHaveBeenCalledTimes(2);
  });
});

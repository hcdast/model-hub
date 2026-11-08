import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { UsageTrackerService } from './usage-tracker.service';

describe('Usage reads distinguish unavailable from zero', () => {
  const apiKey = 'fixture';
  let redis: any, service: UsageTrackerService;
  beforeEach(() => {
    redis = { hgetall: jest.fn().mockResolvedValue({}), scan: jest.fn().mockResolvedValue(['0', []]) };
    service = new UsageTrackerService(redis);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
  it('returns measured zeros for an empty hash, and preserves existing counter conversion', async () => {
    redis.hgetall.mockResolvedValueOnce({ requests: '4', success: '2', failed: '1', totalCost: '123' });
    expect(await service.getUsage(apiKey, { from: '20261101', to: '20261102' })).toEqual([
      { apiKey, date: '20261101', totalRequests: 4, successRequests: 2, failedRequests: 1, totalCost: 1.23 },
      { apiKey, date: '20261102', totalRequests: 0, successRequests: 0, failedRequests: 0, totalCost: 0 },
    ]);
  });
  it('rejects a partially failed range rather than returning fabricated zeros', async () => {
    redis.hgetall.mockResolvedValueOnce({ requests: '4' }).mockRejectedValueOnce(new Error('private redis connection error'));
    const error = await service.getUsage(apiKey, { from: '20261101', to: '20261102' }).catch(error => error);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getStatus()).toBe(503); expect(JSON.stringify(error.getResponse())).not.toContain('private');
  });
  it.each(['scan', 'hgetall'])('reports summary failure when %s is unavailable', async method => {
    redis.scan.mockResolvedValue(['0', ['usage:daily:fixture:20261101']]);
    redis[method].mockRejectedValue(new Error('read failure'));
    await expect(service.getUsageSummary()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('deduplicates repeated SCAN keys before calculating a summary', async () => {
    const key = 'usage:daily:fixture:20261101';
    redis.scan.mockResolvedValueOnce(['12', [key]]).mockResolvedValueOnce(['0', [key]]);
    redis.hgetall.mockResolvedValue({ requests: '8', success: '7' });
    expect(await service.getUsageSummary()).toEqual([{ apiKey, totalRequests: 8, successRequests: 7, failedRequests: 0, totalCost: 0 }]);
    expect(redis.hgetall).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['20260230', '20260301'], ['20261301', '20261302'], ['20261102', '20261101'], ['invalid', '20261102'], ['20260101', '20260201'],
  ])('rejects invalid or excessive dates before accessing Redis: %s - %s', async (from, to) => {
    await expect(service.getUsage(apiKey, { from, to })).rejects.toBeInstanceOf(BadRequestException);
    expect(redis.hgetall).not.toHaveBeenCalled();
  });
  it('accepts a leap day and a 31-day range', async () => {
    expect(await service.getUsage(apiKey, { from: '20240228', to: '20240301' })).toHaveLength(3);
    expect(await service.getUsage(apiKey, { from: '20260101', to: '20260131' })).toHaveLength(31);
  });
  it('keeps usage writes nonblocking when Redis is unavailable', async () => {
    redis.pipeline = () => { throw new Error('offline'); };
    await expect(service.recordRequest(apiKey)).resolves.toBeUndefined();
    await expect(service.recordCompletion(apiKey, true)).resolves.toBeUndefined();
  });
});

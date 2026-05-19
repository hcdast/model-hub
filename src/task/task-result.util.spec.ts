import { isBareHttpUrlString, normalizeTaskResultPayload } from './task-result.util';

describe('normalizeTaskResultPayload', () => {
  it('wraps bare URL string into array', () => {
    const url = 'https://example.com/out.mp4';
    expect(normalizeTaskResultPayload(url)).toEqual([url]);
  });

  it('keeps URL array unchanged', () => {
    const urls = ['https://a.com/1.mp4', 'https://a.com/2.mp4'];
    expect(normalizeTaskResultPayload(urls)).toEqual(urls);
  });

  it('leaves structured object unchanged', () => {
    const obj = { output: ['https://example.com/x.png'], usage: { total_tokens: 10 } };
    expect(normalizeTaskResultPayload(obj)).toEqual(obj);
  });

  it('returns null/undefined as-is', () => {
    expect(normalizeTaskResultPayload(null)).toBeNull();
    expect(normalizeTaskResultPayload(undefined)).toBeUndefined();
  });
});

describe('isBareHttpUrlString', () => {
  it('detects http(s) URLs only', () => {
    expect(isBareHttpUrlString('https://x.com/a.mp4')).toBe(true);
    expect(isBareHttpUrlString('not-a-url')).toBe(false);
    expect(isBareHttpUrlString({ url: 'https://x.com' } as unknown as string)).toBe(false);
  });
});

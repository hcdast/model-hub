import { describe, expect, it } from 'vitest';
import { providerConfigErrorMessage, validateLlmBaseUrl, providerConfigForm, mergeProviderConfigForm } from './provider-config';

describe('Provider LLM endpoint editing', () => {
  it.each([undefined, '', '  ', 'https://llm-fat.akool.io/v1', ' https://llm-fat.akool.io/v1/ ', 'https://gateway.example.com/llm/v1'])
  ('accepts an optional or versioned HTTPS endpoint: %s', value => {
    expect(() => validateLlmBaseUrl(value)).not.toThrow();
  });

  it.each(['https://llm-fat.akool.io', 'http://llm-fat.akool.io/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#fragment', 'https://example.com/api', 'invalid-url'])
  ('blocks invalid endpoints before submitting: %s', value => {
    expect(() => validateLlmBaseUrl(value)).toThrow('/v1');
  });

  it('shows the server validation reason instead of the generic HTTP 400 error', () => {
    const detail = 'LLM Base URL 需要为以 /v1 结尾的 HTTPS 地址';
    expect(providerConfigErrorMessage({ message: 'Request failed with status code 400', response: { data: { message: detail } } }, '保存失败')).toBe(detail);
  });

  it('handles arrays of validation messages and falls back for network errors', () => {
    expect(providerConfigErrorMessage({ response: { data: { message: ['地址无效', '版本缺失'] } } }, '保存失败')).toBe('地址无效；版本缺失');
    expect(providerConfigErrorMessage(new Error('Network Error'), '保存失败')).toBe('Network Error');
    expect(providerConfigErrorMessage({}, '保存失败')).toBe('保存失败');
  });
});

describe('Provider editing version conflicts', () => {
  const base = { provider_name: 'akool-maas', enabled: true, icon_url: '', base_url: 'https://media.example.com/api/v1', llm_base_url: '', max_concurrent: 2, max_per_second: 1, max_per_minute: undefined, poll_max_per_second: 1, poll_max_concurrent: 2 };

  it('uses all form fields from the same detail response as the revision', () => {
    expect(providerConfigForm({ provider_name: 'akool-maas', revision: 4, enabled: true, icon_url: '', base_url: base.base_url,
      extra: { llm_base_url: 'https://llm-fat.akool.io/v1' }, limits: { maxConcurrent: 8, maxPerSecond: 3 }, poll_limits: { max_per_second: 2, max_concurrent: 5 } })).toMatchObject({ max_concurrent: 8, max_per_second: 3, poll_max_per_second: 2, poll_max_concurrent: 5, llm_base_url: 'https://llm-fat.akool.io/v1' });
  });

  it('preserves a local LLM edit and adopts unrelated server changes before retrying', () => {
    const draft = { ...base, llm_base_url: 'https://llm-fat.akool.io/v1' };
    const latest = { ...base, max_concurrent: 10, base_url: 'https://new-media.example.com/api/v1' };
    const result = mergeProviderConfigForm(base, draft, latest);
    expect(result.conflicts).toEqual([]);
    expect(result.values).toMatchObject({ llm_base_url: draft.llm_base_url, max_concurrent: 10, base_url: latest.base_url });
    expect(base.llm_base_url).toBe('');
    expect(latest.llm_base_url).toBe('');
  });

  it('treats the previously saved desired URL as non-conflicting, including trailing slash differences', () => {
    const result = mergeProviderConfigForm(base, { ...base, llm_base_url: ' https://llm-fat.akool.io/v1/ ' }, { ...base, llm_base_url: 'https://llm-fat.akool.io/v1' });
    expect(result.conflicts).toEqual([]);
  });

  it('requires explicit resolution when both editors change the same field differently', () => {
    const draft = { ...base, llm_base_url: 'https://local.example.com/v1' };
    const latest = { ...base, llm_base_url: 'https://remote.example.com/v1' };
    const result = mergeProviderConfigForm(base, draft, latest);
    expect(result.conflicts).toEqual(['llm_base_url']);
    expect(result.values.llm_base_url).toBe(draft.llm_base_url);
    expect(latest.llm_base_url).toBe('https://remote.example.com/v1');
  });

  it('keeps server changes to untouched optional limits and detects conflicting clears', () => {
    const result = mergeProviderConfigForm(base, { ...base, max_per_minute: null }, { ...base, max_per_minute: 20 });
    expect(result.conflicts).toEqual([]);
    expect(result.values.max_per_minute).toBe(20);
    const withLlm = { ...base, llm_base_url: 'https://old.example.com/v1' };
    expect(mergeProviderConfigForm(withLlm, { ...withLlm, llm_base_url: '' }, { ...withLlm, llm_base_url: 'https://remote.example.com/v1' }).conflicts).toEqual(['llm_base_url']);
  });
});

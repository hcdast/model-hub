import { InputNumber, Select } from 'antd';
import type { DramaModel } from '../../services/drama-api';

const labels: Record<string, string> = { zh: '中文普通话', en: '英语', ja: '日语', ko: '韩语', es: '西班牙语', fr: '法语', de: '德语', it: '意大利语', pt: '葡萄牙语', ar: '阿拉伯语', hi: '印地语', neutral: '自然', happy: '开心', sad: '悲伤', angry: '生气', fearful: '害怕', disgusted: '厌恶', surprised: '惊讶' };
export const voiceSettingNames = ['language_code', 'speed', 'emotion', 'volume'];
export default function DramaVoiceSettings({ model, parameters, onChange }: { model: DramaModel; parameters: Record<string, unknown>; onChange: (name: string, value: unknown) => void }) {
  const effective = (name: string) => parameters[name] ?? model.params.find(p => p.name === name)?.default;
  return <section aria-label="旁白语言与语速"><p>2. 调整声音（可保留默认值）</p>{voiceSettingNames.map(name => {
    const p = model.params.find(p => p.name === name); if (!p || p.hide) return null;
    const value = effective(name);
    const emotionUnavailable = name === 'emotion' && effective('language_code') !== 'zh';
    return <div key={name} style={{ marginBottom: 12 }}><label>{({ language_code: '语言', speed: '语速', emotion: '情绪', volume: '生成音量' } as Record<string, string>)[name]}</label>{p.enum ? <Select aria-label={p.label || name} style={{ width: '100%' }} value={value as string} disabled={emotionUnavailable} options={p.enum.map(v => ({ value: v as string, label: labels[String(v)] || String(v) }))} onChange={v => onChange(name, v)} /> : <InputNumber aria-label={p.label || name} style={{ width: '100%' }} value={typeof value === 'number' ? value : undefined} min={p.min} max={p.max} step={name === 'speed' ? 0.05 : 1} precision={name === 'speed' ? 2 : 0} onChange={v => onChange(name, v ?? undefined)} />}{name === 'speed' && <small>1 为正常语速；数值越大，语速越快。</small>}{emotionUnavailable && <small>当前接口仅支持中文情绪；其他语言不会提交情绪参数。</small>}</div>;
  })}</section>;
}

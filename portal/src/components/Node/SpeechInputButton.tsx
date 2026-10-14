import { useEffect, useRef, useState } from 'react';
import { AudioOutlined } from '@ant-design/icons';
import tokens from '../../theme/dark';

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

export default function SpeechInputButton({ prompt, onChange }: { prompt: string; onChange: (prompt: string) => void }) {
  const instance = useRef<Recognition | null>(null);
  const latest = useRef({ prompt, onChange });
  latest.current = { prompt, onChange };
  const [active, setActive] = useState(false);
  const [feedback, setFeedback] = useState('');
  const Constructor = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
  useEffect(() => () => {
    if (instance.current) { instance.current.onresult = null; instance.current.onerror = null; instance.current.onend = null; instance.current.abort(); }
  }, []);
  const toggle = () => {
    if (instance.current) { instance.current.stop(); setFeedback('正在停止语音输入…'); return; }
    if (!Constructor) { setFeedback('此浏览器不支持语音识别，请使用支持 Web Speech API 的浏览器或直接输入。'); return; }
    if (!window.isSecureContext) { setFeedback('语音输入需要 HTTPS 或 localhost 安全环境。'); return; }
    const recognition = new Constructor();
    recognition.lang = 'zh-CN'; recognition.continuous = true; recognition.interimResults = false;
    recognition.onresult = (event) => {
      const pieces: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) if (event.results[index].isFinal) pieces.push(event.results[index][0].transcript);
      if (pieces.length) {
        const text = [latest.current.prompt, pieces.join('')].filter(Boolean).join('\n');
        latest.current.prompt = text;
        latest.current.onChange(text);
        setFeedback('识别文本已写入提示词；点击麦克风停止。');
      }
    };
    recognition.onerror = (event) => {
      const errors: Record<string, string> = { 'not-allowed': '麦克风权限被拒绝，请在浏览器设置中允许访问。', 'service-not-allowed': '浏览器语音服务不可用或已禁用。', 'audio-capture': '未找到可用麦克风，请检查设备。', 'no-speech': '未识别到语音，请重试。', network: '语音服务网络连接失败，请检查网络。', aborted: '语音输入已停止。' };
      setFeedback(errors[event.error] || `语音识别失败：${event.error}`);
    };
    recognition.onend = () => { instance.current = null; setActive(false); setFeedback((value) => value === '正在聆听…' || value === '正在停止语音输入…' ? '语音输入已停止。' : value); };
    instance.current = recognition;
    try { recognition.start(); setActive(true); setFeedback('正在聆听…'); }
    catch (error) { instance.current = null; setActive(false); setFeedback(`无法启动语音输入：${error instanceof Error ? error.message : String(error)}`); }
  };
  return <>
    <button type="button" className="tapnow-icon-btn tapnow-icon-btn--sm" aria-label={active ? '停止语音输入' : '开始语音输入'} aria-pressed={active} title={!Constructor ? '当前浏览器不支持语音识别，点击查看说明' : active ? '停止语音输入' : '开始语音输入'} onClick={toggle}><AudioOutlined /></button>
    {feedback && <span role="status" style={{ flexBasis: '100%', fontSize: tokens.font.size.xs, color: tokens.text.secondary }}>{feedback}</span>}
  </>;
}

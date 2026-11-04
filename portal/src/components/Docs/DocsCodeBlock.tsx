import { Fragment } from 'react';
import { Button, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n';

function highlight(line: string) {
  return line.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:true|false|null|import|from|const|await|async|print)\b|\b\d+(?:\.\d+)?\b|#[^\n]*)/g).map((part, i) => {
    const style = /^["']/.test(part) ? 'string' : /^#/.test(part) ? 'comment'
      : /^(true|false|null|import|from|const|await|async|print)$/.test(part) ? 'keyword' : /^\d/.test(part) ? 'number' : '';
    return style ? <span key={i} className={`reference-token-${style}`}>{part}</span> : <Fragment key={i}>{part}</Fragment>;
  });
}

export default function DocsCodeBlock({ code, language = 'JSON', title }: { code: string; language?: string; title?: string }) {
  const { t } = useI18n();
  const lines = code.split('\n');
  return <div className="reference-code">
    <div className="reference-code-bar"><span>{title || language}</span><Button type="text" size="small" icon={<CopyOutlined />} aria-label={`${t('Copy')} ${title || language}`} onClick={async () => {
      try { await navigator.clipboard.writeText(code); message.success(t('Copied')); } catch { message.error(t('Copy failed')); }
    }}>{t('Copy')}</Button></div>
    <pre tabIndex={0} aria-label={title || language}><code>{lines.map((line, i) => <span className="reference-code-line" key={i}><span aria-hidden="true" className="reference-line-number">{i + 1}</span><span>{highlight(line)}</span>{i < lines.length - 1 ? '\n' : ''}</span>)}</code></pre>
  </div>;
}

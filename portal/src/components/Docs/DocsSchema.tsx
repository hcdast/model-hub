import { Empty } from 'antd';
import type { ParamDocItem } from '../../types/model-params';
import { useI18n } from '../../i18n';

export default function DocsSchema({ params, depth = 0 }: { params: ParamDocItem[]; depth?: number }) {
  const { t, locale } = useI18n();
  const l = (zh: string, en: string, ja = en) => locale === 'zh' ? zh : locale === 'ja' ? ja : en;
  if (!params.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No input parameters documented.')} />;
  return <div className="reference-schema">{params.filter(param => !param.hide).map(param => {
    const nested = param.properties ? Object.entries(param.properties).map(([name, def]) => ({ ...def, name }))
      : param.items ? [{ ...param.items, name: `${param.name}[]` }] : [];
    return <article className="reference-field" key={param.name}>
      <div className="reference-field-heading"><code>{param.name}</code><span className="reference-field-type">{param.type === 'array' && param.items ? `array<${param.items.type}>` : param.type}{param.format ? ` · ${param.format}` : ''}</span>
        <span className={param.required ? 'reference-required' : 'reference-optional'}>{t(param.required ? 'Required' : 'Optional')}</span></div>
      {param.label && param.label !== param.name && <div className="reference-field-label">{param.label}</div>}
      {param.description && <p className="reference-field-description">{param.description}</p>}
      <dl className="reference-constraints">
        {param.default !== undefined && <div><dt>{t('Default')}</dt><dd><code>{JSON.stringify(param.default)}</code></dd></div>}
        {(param.min !== undefined || param.max !== undefined) && <div><dt>{t('Range')}</dt><dd>{param.min ?? '−∞'} – {param.max ?? '∞'}</dd></div>}
        {(param.minLength !== undefined || param.maxLength !== undefined) && <div><dt>{t('Length')}</dt><dd>{param.minLength ?? 0} – {param.maxLength ?? '∞'}</dd></div>}
        {(param.minItems !== undefined || param.maxItems !== undefined) && <div><dt>{t('Items')}</dt><dd>{param.minItems ?? 0} – {param.maxItems ?? '∞'}</dd></div>}
        {param.multipleOf !== undefined && <div><dt>{l('步长', 'Step', 'ステップ')}</dt><dd>{param.multipleOf}</dd></div>}
      </dl>
      {!!param.enum?.length && <div className="reference-enum"><span>{t('Allowed values')}</span><div>{param.enum.map((value, i) => <code key={i}>{JSON.stringify(value)}</code>)}</div></div>}
      {param.enumDependsOn && <div className="reference-dependent"><span>{t('Depends on')} <code>{param.enumDependsOn.param}</code></span>{Object.entries(param.enumDependsOn.map).map(([value, allowed]) => <p key={value}><code>{value}</code><span>→</span>{allowed.map((item, i) => <code key={i}>{JSON.stringify(item)}</code>)}</p>)}</div>}
      {param.media && <div className="reference-media-note">{l('媒体', 'Media', 'メディア')}: {param.media.kind}{param.media.accept?.length ? ` · ${param.media.accept.join(', ')}` : ''}{param.media.maxBytes ? ` · ≤ ${Math.round(param.media.maxBytes / 1024 / 1024 * 100) / 100} MB` : ''}</div>}
      {param.example !== undefined && <details className="reference-nested"><summary>{l('查看示例值', 'View example', 'サンプルを見る')}</summary><pre>{JSON.stringify(param.example, null, 2)}</pre></details>}
      {!!nested.length && depth < 12 && <details className="reference-nested"><summary>{l('展开嵌套字段', 'Show nested fields', 'ネストしたフィールドを表示')} <span>{nested.length}</span></summary><DocsSchema params={nested} depth={depth + 1} /></details>}
    </article>;
  })}</div>;
}

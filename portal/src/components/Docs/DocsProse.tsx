import { Fragment, type ReactNode } from 'react';
import DocsCodeBlock from './DocsCodeBlock';

function inline(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    if (link && /^https?:\/\//i.test(link[2])) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Render the supported documentation blocks as React nodes; model text is never HTML. */
export default function DocsProse({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    if (/^```/.test(lines[i])) {
      const language = lines[i++].slice(3).trim() || 'Code'; const code: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++; blocks.push(<DocsCodeBlock key={i} code={code.join('\n')} language={language} />); continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if (heading) { blocks.push(<h3 key={i}>{inline(heading[2])}</h3>); i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
      const ordered = /^\s*\d+\./.test(lines[i]); const items: ReactNode[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i])) items.push(<li key={i}>{inline(lines[i++].replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))}</li>);
      blocks.push(ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>); continue;
    }
    if (lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(value => value.trim());
      const headers = cells(lines[i]); i += 2; const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(<div className="reference-table-scroll" key={i}><table className="reference-table"><thead><tr>{headers.map((cell, n) => <th key={n}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, n) => <tr key={n}>{row.map((cell, c) => <td key={c}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    const paragraph: string[] = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !/^(?:```|#{1,6}\s|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) && !(lines[i].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || ''))) paragraph.push(lines[i++]);
    blocks.push(<p key={i}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="reference-prose">{blocks}</div>;
}

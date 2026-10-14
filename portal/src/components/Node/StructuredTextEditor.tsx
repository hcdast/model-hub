import { createElement, useLayoutEffect, useRef } from 'react';
import { WorkflowNodeData } from '../../store/workflow-store';
import tokens from '../../theme/dark';

type TextDocument = NonNullable<WorkflowNodeData['textDocument']>;
type TextBlock = TextDocument['blocks'][number];
type TextRun = TextBlock['children'][number];

function plainDocument(prompt: string): TextDocument {
  return { blocks: prompt.split('\n').map((text) => ({ type: 'paragraph', children: [{ text }] })) };
}

function safeColor(color: string | undefined) {
  if (!color) return undefined;
  if (/^#[\da-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(color)) return `#${color.slice(1).split('').map((digit) => digit + digit).join('')}`.toLowerCase();
  // Browsers expose even hex foreColor commands as rgb() in element.style.color.
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(color);
  if (!rgb) return undefined;
  const channels = rgb.slice(1).map(Number);
  if (channels.some((channel) => channel > 255)) return undefined;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function readDocument(root: HTMLElement): TextDocument {
  const blocks: TextBlock[] = [];
  let current: TextBlock | undefined;
  const visit = (node: Node, marks: Omit<TextRun, 'text'> = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!current) current = { type: 'paragraph', children: [] };
      current.children.push({ ...marks, text: node.textContent || '' });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName;
    const isBlock = /^(P|DIV|H1|H2|H3|LI)$/.test(tag) && !(/^(P|DIV)$/.test(tag) && node.closest('li'));
    if (isBlock) {
      if (current?.children.length) blocks.push(current);
      current = { type: tag === 'LI' ? (node.parentElement?.tagName === 'OL' ? 'ordered' : 'bullet') : /^H[123]$/.test(tag) ? tag.toLowerCase() as TextBlock['type'] : 'paragraph', children: [] };
    }
    const next = { ...marks };
    if (tag === 'B' || tag === 'STRONG' || node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600) next.bold = true;
    if (tag === 'I' || tag === 'EM' || node.style.fontStyle === 'italic') next.italic = true;
    if (node.style.fontWeight === 'normal' || node.style.fontWeight === '400') next.bold = false;
    if (node.style.fontStyle === 'normal') next.italic = false;
    const color = safeColor(node.style.color || node.getAttribute('color') || undefined);
    if (color) next.color = color;
    const placeholderBreak = tag === 'BR' && !node.parentElement?.textContent && node.parentElement?.querySelectorAll('br').length === 1;
    if (tag === 'BR' && !placeholderBreak) {
      if (current) blocks.push(current);
      current = { type: 'paragraph', children: [] };
    } else node.childNodes.forEach((child) => visit(child, next));
    if (isBlock && current) { blocks.push(current); current = undefined; }
  };
  root.childNodes.forEach((node) => visit(node));
  if (current) blocks.push(current);
  return { blocks: blocks.length ? blocks.map((block) => ({ ...block, children: block.children.length ? block.children : [{ text: '' }] })) : plainDocument('').blocks };
}

function renderDocument(root: HTMLElement, value: TextDocument) {
  const fragment = document.createDocumentFragment();
  let list: HTMLElement | undefined;
  for (const block of value.blocks) {
    const listTag = block.type === 'bullet' ? 'UL' : block.type === 'ordered' ? 'OL' : undefined;
    if (!listTag) list = undefined;
    else if (!list || list.tagName !== listTag) { list = document.createElement(listTag); fragment.append(list); }
    const element = document.createElement(listTag ? 'li' : ['h1', 'h2', 'h3'].includes(block.type) ? block.type : 'p');
    for (const run of block.children) {
      const span = document.createElement('span');
      span.textContent = run.text;
      if (run.bold !== undefined) span.style.fontWeight = run.bold ? 'bold' : 'normal';
      if (run.italic !== undefined) span.style.fontStyle = run.italic ? 'italic' : 'normal';
      const color = safeColor(run.color);
      if (color) span.style.color = color;
      element.append(span);
    }
    if (!element.textContent) element.append(document.createElement('br'));
    (list || fragment).append(element);
  }
  root.replaceChildren(fragment);
}

/** Native editing preserves IME and selection; only constrained text blocks leave the editor. */
export default function StructuredTextEditor({ value, prompt, onChange }: {
  value?: TextDocument;
  prompt: string;
  onChange: (value: TextDocument, prompt: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const local = useRef('');
  const composing = useRef(false);
  const executingCommand = useRef(false);
  const source = value && value.blocks.map((block) => block.children.map((run) => run.text).join('')).join('\n') === prompt ? value : plainDocument(prompt);
  const serialized = JSON.stringify(source);
  useLayoutEffect(() => {
    if (editor.current && local.current !== serialized && !composing.current) {
      renderDocument(editor.current, source);
      local.current = serialized;
      selection.current = null;
    }
  }, [serialized]);
  const remember = () => {
    const selected = window.getSelection();
    if (selected?.rangeCount && editor.current?.contains(selected.anchorNode) && editor.current.contains(selected.focusNode)) selection.current = selected.getRangeAt(0).cloneRange();
  };
  const publish = () => {
    if (!editor.current || composing.current || executingCommand.current) return;
    const next = readDocument(editor.current);
    local.current = JSON.stringify(next);
    onChange(next, next.blocks.map((block) => block.children.map((run) => run.text).join('')).join('\n'));
    remember();
  };
  const command = (name: string, argument?: string) => {
    const root = editor.current;
    if (!root) return;
    const saved = selection.current?.cloneRange();
    executingCommand.current = true;
    try {
      root.focus();
      const selected = window.getSelection();
      if (saved && root.contains(saved.commonAncestorContainer) && selected) {
        selected.removeAllRanges();
        selected.addRange(saved);
      }
      if (name === 'formatBlock') {
        // A heading cannot also be a list block in the persisted document.
        // Native outdent unwraps the selected list items and retains its undo
        // history; formatBlock alone would only wrap the entire list in H1.
        const nesting = root.querySelectorAll('ul, ol').length;
        for (let depth = 0; depth < nesting; depth += 1) {
          const range = selected?.rangeCount ? selected.getRangeAt(0) : undefined;
          if (!range || !Array.from(root.querySelectorAll('li')).some((item) => range.intersectsNode(item))) break;
          if (!document.execCommand('outdent', false)) break;
        }
      }
      // execCommand emits input synchronously. Publish only after the native
      // mutation has completed, never re-render the controlled node mid-command.
      document.execCommand(name, false, argument);
    } finally {
      executingCommand.current = false;
    }
    publish();
  };
  const controls = [
    ['H1', '一级标题', 'formatBlock', 'h1'], ['H2', '二级标题', 'formatBlock', 'h2'], ['H3', '三级标题', 'formatBlock', 'h3'],
    ['¶', '正文', 'formatBlock', 'p'], ['B', '粗体', 'bold'], ['I', '斜体', 'italic'],
    ['1.', '有序列表', 'insertOrderedList'], ['•', '无序列表', 'insertUnorderedList'], ['↶', '撤销文本编辑', 'undo'], ['↷', '重做文本编辑', 'redo'],
  ];
  return <div className="nodrag nopan nowheel" onKeyDown={(event) => event.stopPropagation()}>
    <style>{`
      .tapnow-structured-input :is(p, div, li, h1, h2, h3) { margin: ${tokens.spacing.xs} 0; font-size: ${tokens.font.size.base} !important; }
      .tapnow-structured-input h1 { font-size: ${tokens.font.size.xl} !important; }
      .tapnow-structured-input h2 { font-size: ${tokens.font.size.lg} !important; }
      .tapnow-structured-input h3 { font-size: ${tokens.font.size.md} !important; }
      .tapnow-structured-input :is(span, font) { font-size: inherit !important; }
    `}</style>
    <div role="toolbar" aria-label="文本格式" style={{ display: 'flex', flexWrap: 'wrap', gap: tokens.spacing.xs, marginBottom: tokens.spacing.sm }}>
      {controls.map(([label, title, name, argument]) => <button type="button" key={title} title={title} aria-label={title} className="tapnow-fmt-btn" onMouseDown={(event) => event.preventDefault()} onClick={() => command(name, argument)}>{label}</button>)}
      <select aria-label="文字颜色" title="文字颜色" defaultValue="" onPointerDown={remember} onChange={(event) => { command('foreColor', event.target.value); event.target.value = ''; }} style={{ color: tokens.text.primary, background: tokens.bg.elevated, borderColor: tokens.border.default }}>
        <option value="" disabled>颜色</option>
        <option value={tokens.text.primary}>默认</option><option value={tokens.status.error}>红色</option><option value={tokens.status.warning}>琥珀</option><option value={tokens.status.success}>绿色</option><option value={tokens.status.info}>蓝色</option>
      </select>
    </div>
    <div ref={editor} contentEditable suppressContentEditableWarning role="textbox" aria-label="文本提示词" aria-multiline="true" className="tapnow-structured-input nodrag nopan nowheel"
      onInput={publish} onKeyUp={remember} onMouseUp={remember} onBlur={remember}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; publish(); }}
      onPaste={(event) => { event.preventDefault(); remember(); command('insertText', event.clipboardData.getData('text/plain')); }}
      onDrop={(event) => event.preventDefault()}
      style={{ minHeight: tokens.spacing.xxl, maxHeight: 320, overflowY: 'auto', color: tokens.text.primary, fontSize: tokens.font.size.base, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} />
  </div>;
}

export function StructuredTextPreview({ value, prompt }: { value?: TextDocument; prompt: string }) {
  const source = value && value.blocks.map((block) => block.children.map((run) => run.text).join('')).join('\n') === prompt ? value : plainDocument(prompt);
  let orderedIndex = 0;
  return <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: tokens.text.primary }}>
    {source.blocks.map((block, index) => {
      orderedIndex = block.type === 'ordered' ? orderedIndex + 1 : 0;
      const children = block.children.map((run, runIndex) => <span key={runIndex} style={{ fontWeight: run.bold === undefined ? undefined : run.bold ? tokens.font.weight.bold : tokens.font.weight.normal, fontStyle: run.italic === undefined ? undefined : run.italic ? 'italic' : 'normal', color: safeColor(run.color) }}>{run.text}</span>);
      const style = { margin: `${tokens.spacing.xs} 0`, fontSize: block.type === 'h1' ? tokens.font.size.xl : block.type === 'h2' ? tokens.font.size.lg : block.type === 'h3' ? tokens.font.size.md : tokens.font.size.base };
      if (block.type === 'bullet' || block.type === 'ordered') return createElement(block.type === 'bullet' ? 'ul' : 'ol', { key: index, style, ...(block.type === 'ordered' ? { start: orderedIndex } : {}) }, <li>{children}</li>);
      return createElement(['h1', 'h2', 'h3'].includes(block.type) ? block.type : 'p', { key: index, style }, children);
    })}
  </div>;
}

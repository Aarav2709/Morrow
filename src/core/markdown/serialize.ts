import type { DocMark, DocNode, PageId } from '../model';

export interface SerializeOptions {
  // current title for a linked page, null keeps the stored label
  titleOf?: (id: PageId) => string | null;
}

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline'];
const MARK_OPEN: Record<string, (mark: DocMark) => string> = {
  link: () => '[',
  bold: () => '**',
  italic: () => '*',
  strike: () => '~~',
  underline: () => '<u>',
};
const MARK_CLOSE: Record<string, (mark: DocMark) => string> = {
  link: (mark) => `](${formatHref(String(mark.attrs?.href ?? ''))})`,
  bold: () => '**',
  italic: () => '*',
  strike: () => '~~',
  underline: () => '</u>',
};

export function docToMarkdown(doc: DocNode, options: SerializeOptions = {}): string {
  const out = blocks(doc.content ?? [], options).trim();
  return out.length > 0 ? `${out}\n` : '';
}

// title becomes a leading heading so the file is readable on its own
export function pageToMarkdown(title: string, doc: DocNode, options: SerializeOptions = {}): string {
  const body = docToMarkdown(doc, options);
  const heading = `# ${escapeText(title.trim() || 'Untitled')}\n`;
  return body ? `${heading}\n${body}` : heading;
}

function blocks(nodes: DocNode[], options: SerializeOptions): string {
  const parts: string[] = [];
  for (const node of nodes) {
    const text = block(node, options);
    if (text !== null) parts.push(text);
  }
  return parts.join('\n\n');
}

function block(node: DocNode, options: SerializeOptions): string | null {
  switch (node.type) {
    case 'paragraph':
      return escapeLineStart(inline(node.content ?? [], options));
    case 'heading': {
      const level = clampLevel(node.attrs?.level);
      return `${'#'.repeat(level)} ${inline(node.content ?? [], options)}`;
    }
    case 'blockquote':
      return prefixLines(blocks(node.content ?? [], options), '> ', '>');
    case 'bulletList':
      return listItems(node, () => '- ', options);
    case 'orderedList': {
      const start = typeof node.attrs?.start === 'number' ? Math.max(0, Math.floor(node.attrs.start)) : 1;
      return listItems(node, (index) => `${start + index}. `, options);
    }
    case 'taskList':
      return listItems(node, (_index, item) => (item.attrs?.checked === true ? '- [x] ' : '- [ ] '), options);
    case 'codeBlock': {
      const code = (node.content ?? []).map((child) => child.text ?? '').join('');
      const fence = '`'.repeat(Math.max(3, longestRun(code, '`') + 1));
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      return `${fence}${language}\n${code}\n${fence}`;
    }
    case 'horizontalRule':
      return '---';
    case 'table':
      return table(node, options);
    default: {
      // unknown blocks keep their text so nothing silently disappears from an export
      if (node.content?.some((child) => child.type === 'text')) return inline(node.content, options);
      return node.content ? blocks(node.content, options) : null;
    }
  }
}

function listItems(
  list: DocNode,
  marker: (index: number, item: DocNode) => string,
  options: SerializeOptions,
): string {
  return (list.content ?? [])
    .map((item, index) => {
      const bullet = marker(index, item);
      const children = item.content ?? [];
      const parts: string[] = [];
      children.forEach((child, childIndex) => {
        const text = block(child, options) ?? '';
        if (childIndex === 0) parts.push(text);
        else parts.push((isList(child) ? '\n' : '\n\n') + text);
      });
      const body = parts.join('');
      const indent = ' '.repeat(bullet.startsWith('- [') ? 2 : bullet.length);
      return (
        bullet +
        body
          .split('\n')
          .map((line, i) => (i === 0 || line === '' ? line : indent + line))
          .join('\n')
      );
    })
    .join('\n');
}

function isList(node: DocNode): boolean {
  return node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList';
}

function table(node: DocNode, options: SerializeOptions): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((child) => inline(child.content ?? [], options, true))
        .join('<br>')
        .replace(/\|/g, '\\|')
        .trim(),
    ),
  );
  if (rows.length === 0) return '';
  const width = Math.max(1, ...rows.map((row) => row.length));
  const pad = (row: string[]) => Array.from({ length: width }, (_, i) => row[i] ?? '');
  const line = (row: string[]) => `| ${pad(row).join(' | ')} |`;
  const [header, ...body] = rows;
  return [line(header!), line(Array.from({ length: width }, () => '---')), ...body.map(line)].join('\n');
}

function inline(nodes: DocNode[], options: SerializeOptions, inTable = false): string {
  let out = '';
  const open: DocMark[] = [];
  let pendingSpace = '';

  const closeTo = (keep: number) => {
    while (open.length > keep) {
      const mark = open.pop()!;
      out += MARK_CLOSE[mark.type]!(mark);
    }
  };

  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      closeTo(0);
      out += pendingSpace + (inTable ? '<br>' : '\\\n');
      pendingSpace = '';
      continue;
    }
    if (node.type === 'pageLink') {
      closeTo(0);
      const id = typeof node.attrs?.id === 'string' ? node.attrs.id : '';
      const label = options.titleOf?.(id) ?? String(node.attrs?.label ?? '');
      out += `${pendingSpace}[[${label.replace(/[[\]]/g, '')}]]`;
      pendingSpace = '';
      continue;
    }
    if (node.type !== 'text' || !node.text) continue;

    const marks = sortMarks(node.marks ?? []);
    const isCode = marks.some((mark) => mark.type === 'code');
    const wrapping = marks.filter((mark) => mark.type !== 'code');
    const [, lead = '', core = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.text) ?? [];

    let keep = 0;
    while (keep < open.length && keep < wrapping.length && sameMark(open[keep]!, wrapping[keep]!)) keep++;
    closeTo(keep);
    out += pendingSpace + lead;
    if (core.length === 0) {
      pendingSpace = trail;
      continue;
    }
    for (const mark of wrapping.slice(keep)) {
      out += MARK_OPEN[mark.type]!(mark);
      open.push(mark);
    }
    out += isCode ? codeSpan(core) : escapeText(core);
    pendingSpace = trail;
  }
  closeTo(0);
  return out + pendingSpace;
}

function sortMarks(marks: DocMark[]): DocMark[] {
  return marks
    .filter((mark) => mark.type === 'code' || MARK_ORDER.includes(mark.type))
    .sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
}

function sameMark(a: DocMark, b: DocMark): boolean {
  return a.type === b.type && (a.type !== 'link' || a.attrs?.href === b.attrs?.href);
}

function codeSpan(text: string): string {
  const fence = '`'.repeat(longestRun(text, '`') + 1);
  const padded = text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
}

export function escapeText(text: string): string {
  return text.replace(/[\\`*_[\]<~]/g, (char) => `\\${char}`);
}

function escapeLineStart(text: string): string {
  return text
    .replace(/^(\s*)(#{1,6}(?=\s|$)|>|[-+](?=\s)|={3,}|-{3,})/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])(?=\s)/, '$1\\$2');
}

function formatHref(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href;
}

function prefixLines(text: string, prefix: string, emptyPrefix: string): string {
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? emptyPrefix : prefix + line))
    .join('\n');
}

function longestRun(text: string, char: string): number {
  let longest = 0;
  let current = 0;
  for (const c of text) {
    current = c === char ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function clampLevel(level: unknown): number {
  return typeof level === 'number' ? Math.min(6, Math.max(1, Math.floor(level))) : 1;
}

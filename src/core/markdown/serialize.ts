import { BACKGROUND_HEX, TEXT_HEX } from '../model';
import type { ColorName, DocMark, DocNode, PageId } from '../model';

export interface SerializeOptions {
  // current title for a linked page, null keeps the stored label
  titleOf?: (id: PageId) => string | null;
  // how a wiki link names its page, a file name or a vault path, defaults to the title
  linkTarget?: (id: PageId) => string | null;
  // relative path an exported file is written to, null when it is not exported
  filePath?: (fileId: string) => string | null;
}

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline', 'highlight', 'textColor'];
const hexOf = (palette: Record<ColorName, string>, mark: DocMark) =>
  typeof mark.attrs?.color === 'string' ? (palette[mark.attrs.color as ColorName] ?? null) : null;
const MARK_OPEN: Record<string, (mark: DocMark) => string> = {
  link: () => '[',
  bold: () => '**',
  italic: () => '*',
  strike: () => '~~',
  underline: () => '<u>',
  highlight: (mark) => {
    const hex = hexOf(BACKGROUND_HEX, mark);
    return hex ? `<mark style="background: ${hex}">` : '==';
  },
  textColor: (mark) => `<span style="color: ${hexOf(TEXT_HEX, mark) ?? TEXT_HEX.gray}">`,
};
const MARK_CLOSE: Record<string, (mark: DocMark) => string> = {
  link: (mark) => `](${formatHref(String(mark.attrs?.href ?? ''))})`,
  bold: () => '**',
  italic: () => '*',
  strike: () => '~~',
  underline: () => '</u>',
  highlight: (mark) => (hexOf(BACKGROUND_HEX, mark) ? '</mark>' : '=='),
  textColor: () => '</span>',
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
    case 'blockMath':
      return `$$\n${String(node.attrs?.latex ?? '').trim()}\n$$`;
    case 'rawBlock':
      return String(node.attrs?.text ?? '');
    case 'horizontalRule':
      return '---';
    case 'table':
      return table(node, options);
    case 'image': {
      const alt = String(node.attrs?.alt ?? '').replace(/[[\]]/g, '');
      const target =
        typeof node.attrs?.fileId === 'string' ? options.filePath?.(node.attrs.fileId) : undefined;
      const src = target ?? (typeof node.attrs?.src === 'string' ? node.attrs.src : null);
      return src ? `![${alt}](${formatHref(src)})` : `*[image${alt ? `: ${alt}` : ''}]*`;
    }
    case 'fileAttachment': {
      const name = escapeText(String(node.attrs?.name ?? 'file'));
      const target = options.filePath?.(String(node.attrs?.fileId ?? ''));
      return target ? `[${name}](${formatHref(target)})` : `*[attachment: ${name}]*`;
    }
    case 'callout': {
      const kind =
        typeof node.attrs?.kind === 'string' && node.attrs.kind
          ? node.attrs.kind
          : String(node.attrs?.tone ?? 'note');
      const fold = node.attrs?.fold === '+' || node.attrs?.fold === '-' ? node.attrs.fold : '';
      const title = typeof node.attrs?.title === 'string' && node.attrs.title ? ` ${node.attrs.title}` : '';
      const body = blocks(node.content ?? [], options);
      return prefixLines(`[!${kind}]${fold}${title}\n${body}`, '> ', '>');
    }
    case 'details': {
      const [summary, content] = node.content ?? [];
      const title = summary ? escapeHtml(inline(summary.content ?? [], options)) : '';
      const body = content ? blocks(content.content ?? [], options) : '';
      return `<details>
<summary>${title}</summary>

${body}

</details>`;
    }
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
        .replace(/(?<!\\)\|/g, '\\|')
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

export function wikiLink(node: DocNode, options: SerializeOptions, inTable = false): string {
  const id = typeof node.attrs?.id === 'string' ? node.attrs.id : null;
  const stored = typeof node.attrs?.target === 'string' ? node.attrs.target : null;
  const target =
    (id ? (options.linkTarget?.(id) ?? options.titleOf?.(id)) : null) ??
    stored ??
    String(node.attrs?.label ?? '');
  const anchor = typeof node.attrs?.anchor === 'string' ? `#${node.attrs.anchor}` : '';
  const alias = typeof node.attrs?.alias === 'string' ? `${inTable ? '\\|' : '|'}${node.attrs.alias}` : '';
  const embed = node.attrs?.embed === true ? '!' : '';
  return `${embed}[[${target.replace(/[[\]|]/g, '')}${anchor}${alias.replace(/[[\]]/g, '')}]]`;
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
      out += pendingSpace + wikiLink(node, options, inTable);
      pendingSpace = '';
      continue;
    }
    if (node.type === 'inlineMath') {
      closeTo(0);
      out += `${pendingSpace}$${String(node.attrs?.latex ?? '').trim()}$`;
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
  return (
    a.type === b.type &&
    a.attrs?.href === b.attrs?.href &&
    (a.attrs?.color ?? null) === (b.attrs?.color ?? null)
  );
}

function codeSpan(text: string): string {
  const fence = '`'.repeat(longestRun(text, '`') + 1);
  const padded = text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
}

function escapeHtml(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// escapes only what would turn into formatting, so files stay pleasant to read in other editors
export function escapeText(text: string): string {
  return escapeMath(
    text
      .replace(/[\\`*<]/g, (char) => `\\${char}`)
      // intraword underscores like snake_case never start emphasis
      .replace(/_/g, (char, index: number, all: string) =>
        /[\p{L}\p{N}]/u.test(all[index - 1] ?? '') && /[\p{L}\p{N}]/u.test(all[index + 1] ?? '')
          ? char
          : `\\${char}`,
      )
      .replace(/~~/g, '\\~\\~')
      .replace(/==/g, '\\=\\=')
      .replace(/\[(?=\[)/g, '\\[')
      .replace(/\](?=[([])/g, '\\]')
      .replace(/&(?=#?\w+;)/g, '\\&'),
  );
}

// escapes only the dollar signs the parser would read as the start of a formula
function escapeMath(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '\\') {
      out += char + (text[i + 1] ?? '');
      i++;
      continue;
    }
    out += char === '$' && opensMath(text, i) ? '\\$' : char;
  }
  return out;
}

function opensMath(text: string, start: number): boolean {
  const display = text[start + 1] === '$';
  const open = display ? 2 : 1;
  const next = text[start + open];
  if (!next || /\s/.test(next) || next === '$') return false;
  const closer = display ? '$$' : '$';
  let end = text.indexOf(closer, start + open);
  while (end !== -1 && text[end - 1] === '\\') end = text.indexOf(closer, end + 1);
  if (end === -1) return false;
  if (/\s$/.test(text.slice(start + open, end))) return false;
  return display || !/\d/.test(text[end + 1] ?? '');
}

function escapeLineStart(text: string): string {
  return text
    .replace(/^(\s*)(#{1,6}(?=\s|$)|>|[-+](?=\s)|={3,}|-{3,}|\$\$)/, '$1\\$2')
    .replace(/^(\s*)\[([^\]]*)\]:/, '$1\\[$2]:')
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

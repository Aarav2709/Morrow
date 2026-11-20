// html pages brought into morrow, from a file or inside a zip such as notion's html export, turned into the
// markdown morrow keeps. pictures and links keep their addresses, a picture beside the page in the zip
// comes in with it the way it would from markdown

const BLOCK = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'FIGURE',
  'BODY',
  'NAV',
]);

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>#])/g, '\\$1');
}

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText((node.textContent ?? '').replace(/\s+/g, ' '));
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as Element;
  const inner = () => [...element.childNodes].map(inline).join('');
  switch (element.tagName) {
    case 'STRONG':
    case 'B': {
      const text = inner().trim();
      return text ? `**${text}**` : '';
    }
    case 'EM':
    case 'I': {
      const text = inner().trim();
      return text ? `*${text}*` : '';
    }
    case 'S':
    case 'DEL':
    case 'STRIKE': {
      const text = inner().trim();
      return text ? `~~${text}~~` : '';
    }
    case 'U':
      return `<u>${inner()}</u>`;
    case 'MARK':
      return `==${inner()}==`;
    case 'CODE':
      return `\`${(element.textContent ?? '').replace(/`/g, "'")}\``;
    case 'BR':
      return '\\\n';
    case 'A': {
      const href = element.getAttribute('href') ?? '';
      const text = inner().trim() || href;
      return href && !href.startsWith('javascript:') ? `[${text}](${formatHref(href)})` : text;
    }
    case 'IMG':
      return image(element);
    case 'SCRIPT':
    case 'STYLE':
    case 'NOSCRIPT':
    case 'TEMPLATE':
      return '';
    default:
      return inner();
  }
}

function formatHref(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href;
}

function image(element: Element): string {
  const src = element.getAttribute('src') ?? '';
  // a picture held in the page itself would fill the markdown, it is left out
  if (!src || src.startsWith('data:')) return '';
  const alt = (element.getAttribute('alt') ?? '').replace(/[[\]]/g, '');
  return `![${alt}](${formatHref(decodeURI(src))})`;
}

function list(element: Element, depth: number): string {
  const ordered = element.tagName === 'OL';
  let index = Number(element.getAttribute('start')) || 1;
  return [...element.children]
    .filter((child) => child.tagName === 'LI')
    .map((item) => {
      const checkbox = item.querySelector(':scope > input[type="checkbox"]');
      const marker = ordered
        ? `${index++}. `
        : checkbox
          ? `- [${(checkbox as HTMLInputElement).checked || checkbox.hasAttribute('checked') ? 'x' : ' '}] `
          : '- ';
      const own = [...item.childNodes].filter(
        (child) => !(child instanceof Element && (child.tagName === 'UL' || child.tagName === 'OL')),
      );
      const text = own.map(inline).join('').replace(/\s+/g, ' ').trim();
      const nested = [...item.children]
        .filter((child) => child.tagName === 'UL' || child.tagName === 'OL')
        .map((child) => list(child, depth + 1))
        .join('\n');
      const pad = '  '.repeat(depth);
      return `${pad}${marker}${text}${nested ? `\n${nested}` : ''}`;
    })
    .join('\n');
}

function table(element: Element): string {
  const rows = [...element.querySelectorAll('tr')].map((row) =>
    [...row.children].map((cell) =>
      [...cell.childNodes].map(inline).join('').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim(),
    ),
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [
    line(rows[0]!),
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...rows.slice(1).map(line),
  ].join('\n');
}

function blocks(parent: Element): string[] {
  const out: string[] = [];
  let run = '';
  const flush = () => {
    const text = run.replace(/[ \t]+/g, ' ').trim();
    if (text) out.push(text);
    run = '';
  };
  for (const node of parent.childNodes) {
    if (!(node instanceof Element)) {
      run += inline(node);
      continue;
    }
    const tag = node.tagName;
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) {
      flush();
      const text = [...node.childNodes].map(inline).join('').replace(/\s+/g, ' ').trim();
      if (text) out.push(`${'#'.repeat(Number(heading[1]))} ${text}`);
    } else if (tag === 'UL' || tag === 'OL') {
      flush();
      const text = list(node, 0);
      if (text) out.push(text);
    } else if (tag === 'PRE') {
      flush();
      const code = node.textContent ?? '';
      const language = /language-(\w+)/.exec(node.querySelector('code')?.className ?? '')?.[1] ?? '';
      const fence = code.includes('```') ? '~~~~' : '```';
      out.push(`${fence}${language}\n${code.replace(/\n$/, '')}\n${fence}`);
    } else if (tag === 'BLOCKQUOTE') {
      flush();
      const inner = blocks(node).join('\n\n');
      if (inner)
        out.push(
          inner
            .split('\n')
            .map((line) => (line ? `> ${line}` : '>'))
            .join('\n'),
        );
    } else if (tag === 'HR') {
      flush();
      out.push('---');
    } else if (tag === 'TABLE') {
      flush();
      const text = table(node);
      if (text) out.push(text);
    } else if (tag === 'IMG') {
      flush();
      const text = image(node);
      if (text) out.push(text);
    } else if (tag === 'DETAILS') {
      flush();
      const summary = node.querySelector(':scope > summary');
      const title = summary ? [...summary.childNodes].map(inline).join('').trim() : '';
      if (summary) summary.remove();
      const inner = blocks(node).join('\n\n');
      out.push(`<details>\n<summary>${title}</summary>\n\n${inner}\n\n</details>`);
    } else if (BLOCK.has(tag) || tag === 'FIGCAPTION') {
      flush();
      out.push(...blocks(node));
    } else if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK'].includes(tag)) {
      continue;
    } else {
      run += inline(node);
    }
  }
  flush();
  return out;
}

// an html page as markdown, with its title from the page's own title or first heading
export function htmlToMarkdown(html: string): { title: string | null; markdown: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.querySelector('title')?.textContent?.trim() || null;
  // notion puts its own heading with the page's title at the top, which is the page's title here
  const main = doc.querySelector('article .page-body') ?? doc.body;
  const parts = blocks(main);
  if (title && parts[0] === `# ${escapeText(title)}`) parts.shift();
  return { title, markdown: parts.join('\n\n') + (parts.length ? '\n' : '') };
}

// a page's title and markdown, the title written as its first heading the way a markdown file would be
export function htmlFileToMarkdown(html: string, fallbackTitle: string): string {
  const { title, markdown } = htmlToMarkdown(html);
  return `# ${title ?? fallbackTitle}\n\n${markdown}`;
}

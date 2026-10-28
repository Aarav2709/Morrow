// turns pages into a small static website: plain html files, one stylesheet, no scripts and nothing loaded from elsewhere
import { canvasFromDoc } from './canvas';
import { formatValue, rowsOf, valueOf } from './database';
import { docToPlainText, inlineText } from './doc';
import { linksInDoc } from './links';
import { displayTitle } from './model';
import type { DocMark, DocNode, FileId, PageId, PageMeta, WorkspaceState } from './model';
import { childrenOf, descendantsOf, livePages } from './tree';
import { safeFileName } from './vault/paths';

export interface SiteOptions {
  // publish this page and its subpages, or every page when null
  rootId: PageId | null;
  title: string;
  // formulas as html, the app renders them with katex into mathml so no fonts are needed
  renderMath?: (latex: string, display: boolean) => string;
}

export interface SiteFile {
  path: string;
  content: string;
}

export interface Site {
  files: SiteFile[];
  // stored files the pages show, with the path each one is copied to
  assets: Map<FileId, string>;
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SAFE_HREF = /^(https?:|mailto:)/i;

export function buildSite(state: WorkspaceState, options: SiteOptions): Site {
  const root = options.rootId ? state.pages[options.rootId] : undefined;
  const pages = root
    ? [root, ...descendantsOf(state.pages, root.id).filter((page) => page.trashedAt === null)]
    : livePages(state.pages);
  const live = new Set(livePages(state.pages).map((page) => page.id));
  // encrypted pages are never published
  const included = pages.filter((page) => live.has(page.id) && !page.encrypted);
  const ids = new Set(included.map((page) => page.id));

  // short readable file names, the published root is the home page
  const names = new Map<PageId, string>();
  const used = new Set<string>(['index']);
  for (const page of included) {
    if (root && page.id === root.id) {
      names.set(page.id, 'index.html');
      continue;
    }
    const base =
      safeFileName(displayTitle(page), 60)
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\p{L}\p{N}_-]/gu, '') || 'page';
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    names.set(page.id, `${name}.html`);
  }

  const assets = new Map<FileId, string>();
  const assetPath = (fileId: FileId) => {
    let path = assets.get(fileId);
    if (!path) {
      const name = fileId.split('/').pop() ?? 'file';
      path = `files/${assets.size + 1}-${name.replace(/[^\w.-]/g, '_')}`;
      assets.set(fileId, path);
    }
    return path;
  };
  const href = (id: PageId) => (ids.has(id) ? names.get(id)! : null);

  const backlinks = new Map<PageId, PageId[]>();
  for (const page of included) {
    const doc = state.docs[page.id];
    if (!doc) continue;
    for (const link of linksInDoc(doc)) {
      if (!ids.has(link.targetId) || link.targetId === page.id) continue;
      const list = backlinks.get(link.targetId) ?? [];
      if (!list.includes(page.id)) list.push(page.id);
      backlinks.set(link.targetId, list);
    }
  }

  const topLevel = root
    ? [root]
    : included.filter((page) => page.parentId === null || !ids.has(page.parentId));
  const nav = (current: PageId) => {
    const branch = (list: PageMeta[], depth: number): string =>
      depth > 6 || list.length === 0
        ? ''
        : `<ul>${list
            .map((page) => {
              const children = childrenOf(state.pages, page.id).filter((child) => ids.has(child.id));
              const label = `${page.icon ? `${escape(page.icon)} ` : ''}${escape(displayTitle(page))}`;
              return `<li><a href="${names.get(page.id)}"${page.id === current ? ' aria-current="page"' : ''}>${label}</a>${branch(children, depth + 1)}</li>`;
            })
            .join('')}</ul>`;
    return branch(topLevel, 0);
  };

  const context: RenderContext = {
    href,
    assetPath,
    titleOf: (id) => (state.pages[id] ? displayTitle(state.pages[id]) : null),
    renderMath: options.renderMath,
  };
  const files: SiteFile[] = [{ path: 'style.css', content: SITE_CSS }];
  for (const page of included) {
    const doc = state.docs[page.id];
    let main = '';
    if (page.kind === 'database' && page.database) main = databaseHtml(state, page, context);
    else if (page.kind === 'canvas') main = canvasHtml(doc, context);
    else if (doc) main = docToHtml(doc, context);
    const children = childrenOf(state.pages, page.id).filter(
      (child) => ids.has(child.id) && page.kind !== 'database',
    );
    const sub = children.length
      ? `<section class="subpages"><h2>Pages inside</h2><ul>${children.map((child) => `<li><a href="${names.get(child.id)}">${escape(displayTitle(child))}</a></li>`).join('')}</ul></section>`
      : '';
    const back = (backlinks.get(page.id) ?? [])
      .map((id) => `<li><a href="${names.get(id)}">${escape(displayTitle(state.pages[id]))}</a></li>`)
      .join('');
    const tags = page.tags.length
      ? `<p class="tags">${page.tags.map((tag) => `<span>#${escape(tag)}</span>`).join(' ')}</p>`
      : '';
    const description = escape(
      docToPlainText(doc ?? { type: 'doc' })
        .slice(0, 160)
        .replace(/\s+/g, ' '),
    );
    files.push({
      path: names.get(page.id)!,
      content: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${description}">
<meta name="generator" content="Morrow">
<title>${escape(displayTitle(page))} · ${escape(options.title)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<nav class="site-nav" aria-label="Pages"><a class="site-title" href="${root ? 'index.html' : (names.get(topLevel[0]?.id ?? '') ?? 'index.html')}">${escape(options.title)}</a>${nav(page.id)}</nav>
<main>
<article>
<h1>${page.icon ? `<span class="icon">${escape(page.icon)}</span> ` : ''}${escape(displayTitle(page))}</h1>
${tags}${main}
</article>
${sub}${back ? `<section class="backlinks"><h2>Linked from</h2><ul>${back}</ul></section>` : ''}
</main>
</body>
</html>
`,
    });
  }
  // a whole vault gets a home page that lists its top level pages
  if (!root) {
    files.push({
      path: 'index.html',
      content: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(options.title)}</title><link rel="stylesheet" href="style.css"></head>
<body><nav class="site-nav" aria-label="Pages"><a class="site-title" href="index.html">${escape(options.title)}</a>${nav('')}</nav><main><article><h1>${escape(options.title)}</h1><ul>${topLevel
        .map((page) => `<li><a href="${names.get(page.id)}">${escape(displayTitle(page))}</a></li>`)
        .join('')}</ul></article></main></body></html>
`,
    });
  }
  return { files, assets };
}

export interface RenderContext {
  href: (id: PageId) => string | null;
  assetPath: (fileId: FileId) => string;
  titleOf: (id: PageId) => string | null;
  renderMath: ((latex: string, display: boolean) => string) | undefined;
}

const MARK_TAGS: Record<string, [string, string]> = {
  bold: ['<strong>', '</strong>'],
  italic: ['<em>', '</em>'],
  underline: ['<u>', '</u>'],
  strike: ['<s>', '</s>'],
  code: ['<code>', '</code>'],
  highlight: ['<mark>', '</mark>'],
};

function wrapMarks(html: string, marks: DocMark[] = []): string {
  let out = html;
  for (const mark of marks) {
    if (mark.type === 'link') {
      const target = String(mark.attrs?.href ?? '');
      out = SAFE_HREF.test(target) ? `<a href="${escape(target)}" rel="noopener noreferrer">${out}</a>` : out;
    } else {
      const tags = MARK_TAGS[mark.type];
      if (tags) out = `${tags[0]}${out}${tags[1]}`;
    }
  }
  return out;
}

function formatDate(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function inline(nodes: DocNode[] = [], context: RenderContext): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return wrapMarks(escape(node.text ?? ''), node.marks);
        case 'hardBreak':
          return '<br>';
        case 'inlineMath': {
          const latex = String(node.attrs?.latex ?? '');
          return context.renderMath
            ? context.renderMath(latex, false)
            : `<code class="math">${escape(latex)}</code>`;
        }
        case 'dateMention':
          return `<time class="date-mention" datetime="${escape(String(node.attrs?.date ?? ''))}">${escape(formatDate(String(node.attrs?.date ?? '')))}</time>`;
        case 'pageLink': {
          const id = typeof node.attrs?.id === 'string' ? node.attrs.id : null;
          const label = escape(
            String(
              node.attrs?.alias ??
                (id ? context.titleOf(id) : null) ??
                node.attrs?.label ??
                node.attrs?.target ??
                '',
            ),
          );
          const target = id ? context.href(id) : null;
          return target
            ? `<a class="page-link" href="${target}">${label}</a>`
            : `<span class="page-link missing">${label}</span>`;
        }
        default:
          return inline(node.content, context);
      }
    })
    .join('');
}

export function docToHtml(doc: DocNode, context: RenderContext): string {
  const block = (node: DocNode): string => {
    const children = () => (node.content ?? []).map(block).join('\n');
    switch (node.type) {
      case 'paragraph':
        return `<p>${inline(node.content, context)}</p>`;
      case 'heading': {
        const level = Math.min(6, Math.max(2, Number(node.attrs?.level ?? 1) + 1));
        return `<h${level}>${inline(node.content, context)}</h${level}>`;
      }
      case 'bulletList':
        return `<ul>${children()}</ul>`;
      case 'orderedList':
        return `<ol start="${Number(node.attrs?.start ?? 1) || 1}">${children()}</ol>`;
      case 'listItem':
        return `<li>${children()}</li>`;
      case 'taskList':
        return `<ul class="tasks">${children()}</ul>`;
      case 'taskItem':
        return `<li><input type="checkbox" disabled${node.attrs?.checked ? ' checked' : ''}> ${children()}</li>`;
      case 'blockquote':
        return `<blockquote>${children()}</blockquote>`;
      case 'callout': {
        const title =
          typeof node.attrs?.title === 'string' && node.attrs.title
            ? `<p class="callout-title">${escape(node.attrs.title)}</p>`
            : '';
        return `<aside class="callout tone-${escape(String(node.attrs?.tone ?? 'note'))}">${title}${children()}</aside>`;
      }
      case 'columns':
        return `<div class="columns" style="--columns:${(node.content ?? []).length}">${children()}</div>`;
      case 'column':
        return `<div class="column">${children()}</div>`;
      case 'tableOfContents': {
        const headings = (doc.content ?? []).filter((child) => child.type === 'heading');
        if (!headings.length) return '';
        return `<nav class="toc">${headings
          .map(
            (heading) =>
              `<p class="toc-${Math.min(3, Number(heading.attrs?.level ?? 1))}">${escape(inlineText(heading))}</p>`,
          )
          .join('')}</nav>`;
      }
      case 'details': {
        const [summary, content] = node.content ?? [];
        const level = Number(summary?.attrs?.level);
        const title = inline(summary?.content, context);
        return `<details><summary>${level >= 1 && level <= 3 ? `<h${level}>${title}</h${level}>` : title}</summary>${(content?.content ?? []).map(block).join('\n')}</details>`;
      }
      case 'codeBlock': {
        const language =
          typeof node.attrs?.language === 'string' ? ` class="language-${escape(node.attrs.language)}"` : '';
        return `<pre><code${language}>${escape((node.content ?? []).map((child) => child.text ?? '').join(''))}</code></pre>`;
      }
      case 'blockMath': {
        const latex = String(node.attrs?.latex ?? '');
        return `<div class="math-block">${context.renderMath ? context.renderMath(latex, true) : `<pre>${escape(latex)}</pre>`}</div>`;
      }
      case 'rawBlock':
        return `<pre class="raw">${escape(String(node.attrs?.text ?? ''))}</pre>`;
      case 'horizontalRule':
        return '<hr>';
      case 'table':
        return `<div class="table"><table>${children()}</table></div>`;
      case 'tableRow':
        return `<tr>${children()}</tr>`;
      case 'tableHeader':
        return `<th>${(node.content ?? []).map((child) => inline(child.content, context)).join('<br>')}</th>`;
      case 'tableCell':
        return `<td>${(node.content ?? []).map((child) => inline(child.content, context)).join('<br>')}</td>`;
      case 'image': {
        const alt = escape(String(node.attrs?.alt ?? ''));
        if (typeof node.attrs?.fileId === 'string')
          return `<figure><img src="${context.assetPath(node.attrs.fileId)}" alt="${alt}" loading="lazy"></figure>`;
        // a published page never loads anything from elsewhere, remote images become links
        const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
        return SAFE_HREF.test(src)
          ? `<p><a href="${escape(src)}" rel="noopener noreferrer">${alt || 'Image'}</a></p>`
          : '';
      }
      case 'fileAttachment': {
        const fileId = String(node.attrs?.fileId ?? '');
        return `<p class="file"><a href="${context.assetPath(fileId)}" download>${escape(String(node.attrs?.name ?? 'file'))}</a></p>`;
      }
      default:
        return children();
    }
  };
  return (doc.content ?? []).map(block).join('\n');
}

export function databaseHtml(state: WorkspaceState, page: PageMeta, context: RenderContext): string {
  const database = page.database!;
  const rows = rowsOf(state, page.id);
  const head = `<tr><th>Name</th>${database.properties.map((prop) => `<th>${escape(prop.name)}</th>`).join('')}</tr>`;
  const body = rows
    .map((row) => {
      const target = context.href(row.id);
      const title = escape(displayTitle(row));
      const cells = database.properties
        .map((prop) => `<td>${escape(formatValue(prop, valueOf(row, prop.id, database)))}</td>`)
        .join('');
      return `<tr><td>${target ? `<a href="${target}">${title}</a>` : title}</td>${cells}</tr>`;
    })
    .join('');
  return `<div class="table"><table>${head}${body}</table></div>`;
}

function canvasHtml(doc: DocNode | undefined, context: RenderContext): string {
  const data = canvasFromDoc(doc);
  const cards = data.nodes
    .filter((node) => node.type !== 'group')
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((node) => {
      if (node.type === 'text')
        return `<div class="card">${node.text
          .split('\n')
          .map((line) => `<p>${escape(line)}</p>`)
          .join('')}</div>`;
      if (node.type === 'page') {
        const target = context.href(node.pageId);
        const title = escape(context.titleOf(node.pageId) ?? 'Missing page');
        return `<div class="card">${target ? `<a href="${target}">${title}</a>` : title}</div>`;
      }
      if (node.type === 'link')
        return SAFE_HREF.test(node.url)
          ? `<div class="card"><a href="${escape(node.url)}" rel="noopener noreferrer">${escape(node.url)}</a></div>`
          : '';
      if (node.type === 'file')
        return `<div class="card"><a href="${context.assetPath(node.file)}">${escape(node.file.split('/').pop() ?? '')}</a></div>`;
      return '';
    })
    .join('');
  return `<div class="cards">${cards}</div>`;
}

const SITE_CSS = `:root{color-scheme:light dark;--bg:#fbfaf7;--text:#22201c;--muted:#6b665d;--line:#e6e2d9;--accent:#b04f29;--soft:rgba(192,88,47,.1);--code:#f1eee8}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--text:#e9e5dd;--muted:#a49e93;--line:#2f2d2a;--accent:#e27d50;--soft:rgba(226,125,80,.15);--code:#262421}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.7 Georgia,'Iowan Old Style',serif;display:grid;grid-template-columns:260px minmax(0,1fr)}
.site-nav{position:sticky;top:0;height:100vh;overflow:auto;padding:24px 16px;border-right:1px solid var(--line);font:14px/1.5 system-ui,sans-serif}
.site-nav ul{list-style:none;margin:0;padding-left:12px}.site-nav>ul{padding:0}.site-nav a{display:block;padding:3px 6px;border-radius:5px;color:var(--muted);text-decoration:none}
.site-nav a:hover,.site-nav a[aria-current]{background:var(--soft);color:var(--text)}.site-title{font-weight:600;color:var(--text)!important;margin-bottom:12px}
main{max-width:760px;width:100%;margin:0 auto;padding:56px 32px}h1{font-size:2.2em;line-height:1.2}a{color:var(--accent)}
.page-link{text-decoration:none;background:var(--soft);border-radius:3px;padding:0 .2em}.page-link.missing{color:var(--muted);background:none}
code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85em;background:var(--code);border-radius:5px}code{padding:.1em .3em}pre{padding:14px 16px;overflow:auto}pre code{padding:0;background:none}
blockquote{margin:0;padding-left:16px;border-left:3px solid var(--line);color:var(--muted)}mark{background:rgba(214,160,40,.3);color:inherit}
.callout{padding:10px 16px;margin:1em 0;border-left:3px solid #4f7aa8;background:rgba(79,122,168,.09);border-radius:6px}.tone-tip{border-color:#4d8a5c;background:rgba(77,138,92,.1)}.tone-warning{border-color:#b7791f;background:rgba(183,121,31,.11)}.tone-danger{border-color:#b3261e;background:rgba(179,38,30,.08)}.callout-title{font-weight:600;margin:0}summary>h1,summary>h2,summary>h3{display:inline}
.table{overflow:auto}table{border-collapse:collapse;font:15px/1.5 system-ui,sans-serif}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}th{color:var(--muted);font-weight:500}
ul.tasks{list-style:none;padding-left:4px}img{max-width:100%;border-radius:6px}figure{margin:1em 0}.math-block{overflow:auto;text-align:center}
.tags span{font:13px system-ui,sans-serif;color:var(--accent);background:var(--soft);padding:2px 8px;border-radius:99px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;font:15px/1.5 system-ui,sans-serif}.card p{margin:0}
.subpages,.backlinks{margin-top:3em;padding-top:1em;border-top:1px solid var(--line);font:15px/1.6 system-ui,sans-serif}.subpages h2,.backlinks h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
@media (max-width:800px){body{display:block}.site-nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}main{padding:32px 20px}}
`;

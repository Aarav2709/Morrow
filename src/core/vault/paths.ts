// vault paths are always relative to the vault folder and use forward slashes

export const TRASH_DIR = '.trash';
export const MORROW_DIR = '.morrow';
export const ATTACHMENTS_DIR = 'attachments';

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);

export function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function extension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function stripExtension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? path.slice(0, path.length - (name.length - dot)) : path;
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

export function isPageFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.canvas');
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extension(path));
}

// hidden folders belong to other tools, except the trash which holds trashed pages
export function isHiddenPath(path: string): boolean {
  return path.split('/').some((part, index) => part.startsWith('.') && !(index === 0 && part === TRASH_DIR));
}

export function isInTrash(path: string): boolean {
  return path === TRASH_DIR || path.startsWith(`${TRASH_DIR}/`);
}

// resolves ./ and ../ against a folder, null when the path escapes the vault
export function resolveRelative(fromDir: string, href: string): string | null {
  const parts = fromDir ? fromDir.split('/') : [];
  for (const part of href.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

// the shortest relative path from a folder to a file, as markdown links expect
export function relativePath(fromDir: string, to: string): string {
  const from = fromDir ? fromDir.split('/') : [];
  const target = to.split('/');
  let common = 0;
  while (common < from.length && common < target.length - 1 && from[common] === target[common]) common++;
  return [...Array<string>(from.length - common).fill('..'), ...target.slice(common)].join('/');
}

// a title turned into a name every common file system accepts
export function safeFileName(title: string, maxLength = 60): string {
  const printable = [...title].map((char) => (char.charCodeAt(0) < 32 ? ' ' : char)).join('');
  const cleaned = printable
    .replace(/[<>:"/\\|?*#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, maxLength)
    .trim();
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  return !cleaned || reserved.test(cleaned) ? 'Untitled' : cleaned;
}

export function uniqueName(name: string, used: Set<string>, separator = ' '): string {
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name}${separator}${n}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function encodePathForUrl(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

// the copies sync apps keep when a file changed on two computers at once, and who made them
const CONFLICT_COPIES: Array<{ pattern: RegExp; app: string }> = [
  // dropbox and nextcloud: Name (Aarav's conflicted copy 2026-10-19)
  { pattern: /^(.+?) \([^()]*conflicted copy[^()]*\)$/i, app: 'your sync app' },
  // syncthing: Name.sync-conflict-20261019-101500-ABCDEFG
  { pattern: /^(.+?)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}$/, app: 'Syncthing' },
  // morrow's own sync between computers
  { pattern: /^(.+?) \(conflict from [^()]+\)$/, app: 'Morrow sync' },
];

// the file a conflict copy was made from, or null when the path is not one
export function conflictOriginal(path: string): { original: string; app: string } | null {
  const ext = extension(path);
  const stem = basename(stripExtension(path));
  for (const { pattern, app } of CONFLICT_COPIES) {
    const match = pattern.exec(stem);
    if (match) return { original: joinPath(dirname(path), `${match[1]}${ext ? `.${ext}` : ''}`), app };
  }
  return null;
}

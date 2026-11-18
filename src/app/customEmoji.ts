// pictures of your own used like emoji: as a page's icon, written emoji:name, and in the text as :name:,
// which other apps show as the words they are. kept in the vault in .morrow/emoji, one file each, named by
// the short name that calls it up, so they sync with the vault
import { useSyncExternalStore } from 'react';
import { desktop } from './platform/desktop';

const FOLDER = '.morrow/emoji';
const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
export const MAX_EMOJI_BYTES = 1024 * 1024;
export const CUSTOM_PREFIX = 'emoji:';

export interface CustomEmoji {
  name: string;
  path: string;
  url: string;
}

let emoji: CustomEmoji[] = [];
let byName = new Map<string, CustomEmoji>();
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: CustomEmoji[]): void {
  for (const item of emoji) if (!next.includes(item)) URL.revokeObjectURL(item.url);
  emoji = next.sort((a, b) => a.name.localeCompare(b.name));
  byName = new Map(next.map((item) => [item.name, item]));
  listeners.forEach((listener) => listener());
  // text showing :name: draws it again with its picture
  window.dispatchEvent(new Event('morrow:custom-emoji'));
}

// a short name as typed between colons: small letters, digits, - and _
export function emojiName(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

async function read(path: string): Promise<CustomEmoji | null> {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const type = TYPES[ext];
  const name = emojiName(path.split('/').pop() ?? '');
  if (!type || !name) return null;
  const bytes = await desktop?.vault?.readBytes(path);
  if (!bytes) return null;
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type }));
  return { name, path, url };
}

export function loadCustomEmoji(force = false): Promise<void> {
  if (force) loaded = null;
  loaded ??= (async () => {
    try {
      const files = (await desktop?.vault?.list(FOLDER)) ?? [];
      const items = await Promise.all(files.slice(0, 500).map((file) => read(file.path)));
      publish(items.filter((item): item is CustomEmoji => item !== null));
    } catch {
      // no emoji of your own yet
    }
  })();
  return loaded;
}

export function useCustomEmoji(): CustomEmoji[] {
  void loadCustomEmoji();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => emoji,
  );
}

export function customEmoji(name: string): CustomEmoji | null {
  void loadCustomEmoji();
  return byName.get(name) ?? null;
}

export function customEmojiList(): CustomEmoji[] {
  return emoji;
}

// a picture added under a short name, a number after it when that name is taken
export async function addCustomEmoji(file: File, wanted?: string): Promise<CustomEmoji | null> {
  await loadCustomEmoji();
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const fromType = Object.entries(TYPES).find(([, type]) => type === file.type)?.[0];
  const kind = TYPES[ext] ? ext : fromType;
  if (!kind || file.size > MAX_EMOJI_BYTES || !desktop?.vault) return null;
  const base = emojiName(wanted ?? file.name) || 'emoji';
  let name = base;
  for (let n = 2; byName.has(name); n++) name = `${base}_${n}`;
  const path = `${FOLDER}/${name}.${kind}`;
  await desktop.vault.createFile(path, await file.arrayBuffer());
  await loadCustomEmoji(true);
  return byName.get(name) ?? null;
}

export async function removeCustomEmoji(name: string): Promise<void> {
  const item = byName.get(name);
  if (!item) return;
  await desktop?.vault?.apply([{ op: 'delete', path: item.path }]);
  await loadCustomEmoji(true);
}

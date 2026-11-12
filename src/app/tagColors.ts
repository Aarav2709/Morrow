// colours picked for #tags and for the options of select properties, the same name has the same colour
// everywhere. kept for the whole vault in .morrow/tag-colors.json, a tag without one gets one from its name
import { useSyncExternalStore } from 'react';
import { COLORS } from '../core/model';
import type { ColorName } from '../core/model';
import { setPickedTagColors } from '../core/tags';
import { desktop } from './platform/desktop';

const FILE = '.morrow/tag-colors.json';
let colors: Record<string, ColorName> = {};
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Record<string, ColorName>): void {
  colors = next;
  setPickedTagColors(next);
  listeners.forEach((listener) => listener());
  // pages showing #tags draw them again in their new colour
  window.dispatchEvent(new Event('morrow:tag-colors'));
}

export function loadTagColors(): Promise<void> {
  loaded ??= (async () => {
    try {
      const text = await desktop?.vault?.readText(FILE);
      const raw = text ? (JSON.parse(text) as { colors?: Record<string, unknown> }) : null;
      const next: Record<string, ColorName> = {};
      for (const [key, value] of Object.entries(raw?.colors ?? {}))
        if ((COLORS as readonly string[]).includes(value as string))
          next[key.toLowerCase()] = value as ColorName;
      publish(next);
    } catch {
      // no colours picked yet
    }
  })();
  return loaded;
}

export function useTagColors(): Record<string, ColorName> {
  void loadTagColors();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => colors,
  );
}

export async function setTagColor(name: string, color: ColorName | null): Promise<void> {
  await loadTagColors();
  const next = { ...colors };
  if (color) next[name.toLowerCase()] = color;
  else delete next[name.toLowerCase()];
  publish(next);
  await desktop?.vault?.apply([
    { op: 'write', path: FILE, text: `${JSON.stringify({ colors: next }, null, 2)}\n` },
  ]);
}

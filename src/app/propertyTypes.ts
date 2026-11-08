// the type picked for a property outside a database, when its value alone can not say. a select holds one
// word just as text does, so the choice is kept for the whole vault in .morrow/property-types.json
import { useSyncExternalStore } from 'react';
import { desktop } from './platform/desktop';

export type ChosenType = 'select' | 'url' | 'text';

const FILE = '.morrow/property-types.json';
let types: Record<string, ChosenType> = {};
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  loaded ??= (async () => {
    try {
      const text = await desktop?.vault?.readText(FILE);
      const raw = text ? (JSON.parse(text) as { types?: Record<string, unknown> }) : null;
      const next: Record<string, ChosenType> = {};
      for (const [key, value] of Object.entries(raw?.types ?? {}))
        if (value === 'select' || value === 'url' || value === 'text') next[key] = value;
      types = next;
      listeners.forEach((listener) => listener());
    } catch {
      // no types chosen yet
    }
  })();
  return loaded;
}

export function usePropertyTypes(): Record<string, ChosenType> {
  void load();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => types,
  );
}

export async function setPropertyType(key: string, type: ChosenType | null): Promise<void> {
  await load();
  const next = { ...types };
  if (type) next[key] = type;
  else delete next[key];
  types = next;
  listeners.forEach((listener) => listener());
  await desktop?.vault?.apply([
    { op: 'write', path: FILE, text: `${JSON.stringify({ types: next }, null, 2)}\n` },
  ]);
}

// what plugins add to morrow, kept apart from the plugins themselves so the palette and the slash menu can
// list them without loading anything
import type { Editor, Range } from '@tiptap/core';
import type { LucideIcon } from 'lucide-react';
import type { Action } from '../actions';

export interface PluginBlock {
  id: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  keywords: string;
  run: (editor: Editor, range: Range) => void;
}

const actions = new Map<string, { owner: string; action: Action }>();
const blocks = new Map<string, { owner: string; block: PluginBlock }>();
const listeners = new Set<() => void>();
let version = 0;

const changed = () => {
  version++;
  for (const listener of listeners) listener();
};

export function pluginActions(): Action[] {
  return [...actions.values()].map((entry) => entry.action);
}

export function pluginBlocks(): PluginBlock[] {
  return [...blocks.values()].map((entry) => entry.block);
}

export function addPluginAction(owner: string, action: Action): () => void {
  actions.set(action.id, { owner, action });
  changed();
  return () => {
    if (actions.get(action.id)?.owner === owner) actions.delete(action.id);
    changed();
  };
}

export function addPluginBlock(owner: string, block: PluginBlock): () => void {
  blocks.set(block.id, { owner, block });
  changed();
  return () => {
    if (blocks.get(block.id)?.owner === owner) blocks.delete(block.id);
    changed();
  };
}

export function subscribePlugins(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pluginsVersion(): number {
  return version;
}

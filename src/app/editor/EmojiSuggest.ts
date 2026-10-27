import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { loadEmoji, readRecent, rememberEmoji } from '../components/EmojiPicker';
import type { EmojiEntry } from '../components/EmojiPicker';
import { t } from '../i18n';
import type { MenuItem } from './SuggestionMenu';
import { renderSuggestion } from './SuggestionMenu';

// emoji whose name starts with the words typed come first, then ones with a tag that does, then any
// whose name has them somewhere. ones picked lately win a tie
export function matchEmoji(list: EmojiEntry[], query: string, recent: string[] = []): EmojiEntry[] {
  const words = query.toLowerCase().replace(/_/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const phrase = words.join(' ');
  const rank = (item: EmojiEntry): number => {
    if (item.label.startsWith(phrase)) return 0;
    if (item.label.split(' ').some((word) => word.startsWith(phrase))) return 1;
    if (item.tags.some((tag) => tag.startsWith(phrase))) return 2;
    if (words.every((word) => item.label.includes(word) || item.tags.some((tag) => tag.startsWith(word))))
      return 3;
    return -1;
  };
  const used = (item: EmojiEntry) => {
    const index = recent.indexOf(item.unicode);
    return index === -1 ? recent.length : index;
  };
  return list
    .map((item) => ({ item, score: rank(item) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || used(a.item) - used(b.item) || a.item.order - b.item.order)
    .map((entry) => entry.item);
}

// a colon and two letters, like :ro, lists the emoji that match to drop one in without leaving the keys.
// a colon in a time like 10:30 or before a space never opens it
export const EmojiSuggest = Extension.create({
  name: 'emojiSuggest',
  addProseMirrorPlugins() {
    return [
      Suggestion<MenuItem, MenuItem>({
        editor: this.editor,
        pluginKey: new PluginKey('emojiSuggest'),
        char: ':',
        allowSpaces: false,
        shouldShow: ({ query }) => /^[\p{L}\p{N}_+-]{2,30}$/u.test(query),
        allow: ({ state }) => {
          const { $from } = state.selection;
          return (
            $from.parent.type.name !== 'codeBlock' && !$from.marks().some((mark) => mark.type.name === 'code')
          );
        },
        items: async ({ query }) => {
          const list = await loadEmoji();
          return matchEmoji(list, query, readRecent())
            .slice(0, 8)
            .map((item) => ({ id: item.unicode, title: item.label, emoji: item.unicode }));
        },
        command: ({ editor, range, props }) => {
          rememberEmoji(props.id);
          editor.chain().focus().insertContentAt(range, props.id).run();
        },
        render: renderSuggestion(() => t('emoji.emoji'), '', 'insert'),
      }),
    ];
  },
});

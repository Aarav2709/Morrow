import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { findMatches } from './Blocks';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph block*' },
    text: {},
  },
});

describe('find in page', () => {
  it('finds words inside lists as well as in plain paragraphs', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('Plant tomatoes')]),
      schema.node('bulletList', null, [
        schema.node('listItem', null, [
          schema.node('paragraph', null, [schema.text('water the Tomatoes')]),
          schema.node('bulletList', null, [
            schema.node('listItem', null, [schema.node('paragraph', null, [schema.text('tomatoes again')])]),
          ]),
        ]),
      ]),
    ]);
    const state = EditorState.create({ doc });
    const matches = findMatches(state, 'tomatoes', false);
    expect(matches).toHaveLength(3);
    expect(matches.map((match) => state.doc.textBetween(match.from, match.to))).toEqual([
      'tomatoes',
      'Tomatoes',
      'tomatoes',
    ]);
    expect(findMatches(state, 't.m', true)).toHaveLength(3);
    // with match case only the word as typed counts
    expect(findMatches(state, 'Tomatoes', false, true)).toHaveLength(1);
    expect(findMatches(state, 'T.m', true, true)).toHaveLength(1);
  });
});

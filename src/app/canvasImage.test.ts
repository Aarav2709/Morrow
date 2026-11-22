import { describe, expect, it } from 'vitest';
import { canvasBounds, colourOf } from './canvasImage';

describe('a canvas drawn as a picture', () => {
  it('reads the preset colours, hex colours and nothing else', () => {
    expect(colourOf('1', '#000')).toBe('#e5484d');
    expect(colourOf('#abcdef', '#000')).toBe('#abcdef');
    expect(colourOf(undefined, '#000')).toBe('#000');
    // a colour that could break out of the canvas style string is left out
    expect(colourOf('red; x', '#000')).toBe('#000');
  });

  it('covers every card with a margin around them', () => {
    const bounds = canvasBounds({
      nodes: [
        { id: 'a', type: 'text', text: 'one', x: -100, y: 20, width: 200, height: 80 },
        { id: 'b', type: 'group', x: 300, y: -50, width: 100, height: 400 },
      ],
      edges: [],
    });
    expect(bounds).toEqual({ x: -140, y: -90, width: 580, height: 480 });
  });

  it('has a size of its own when the canvas is empty', () => {
    expect(canvasBounds({ nodes: [], edges: [] })).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });
});

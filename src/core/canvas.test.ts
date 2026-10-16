import { describe, expect, it } from 'vitest';
import { readCanvas, writeCanvas } from './canvas';

describe('canvas drawings', () => {
  it('keeps freehand strokes through a save and load', () => {
    const data = readCanvas(
      {
        nodes: [
          {
            id: 'ink1',
            type: 'drawing',
            x: 10,
            y: 20,
            width: 100,
            height: 50,
            strokes: [
              { points: [0, 0, 10, 10, 20, 5], width: 4, color: '4' },
              { points: [5, 5, 40, 40], width: 14, highlighter: true },
            ],
          },
        ],
        edges: [],
      },
      () => null,
    )!;
    expect(data.nodes).toHaveLength(1);
    const again = readCanvas(JSON.parse(writeCanvas(data, () => null)), () => null)!;
    expect(again).toEqual(data);
  });

  it('drops broken strokes and drawings left with none', () => {
    const data = readCanvas(
      {
        nodes: [
          { id: 'a', type: 'drawing', x: 0, y: 0, width: 10, height: 10, strokes: [{ points: [1] }, 'x'] },
          {
            id: 'b',
            type: 'drawing',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            strokes: [{ points: [1, 2, 3], color: 'red' }],
          },
        ],
        edges: [],
      },
      () => null,
    )!;
    expect(data.nodes.map((node) => node.id)).toEqual(['b']);
    const node = data.nodes[0]!;
    expect(node.type === 'drawing' && node.strokes[0]).toEqual({ points: [1, 2], width: 3 });
  });
});

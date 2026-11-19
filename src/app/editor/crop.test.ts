// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { areaForRatio, dragArea } from './CropDialog';

describe('cropping a picture', () => {
  it('starts a shape as large as fits, in the middle', () => {
    expect(areaForRatio(null, { width: 400, height: 200 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    // a square in a picture twice as wide as tall is half its width
    expect(areaForRatio(1, { width: 400, height: 200 })).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
  });

  it('keeps the frame inside the picture as it is dragged', () => {
    const start = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    expect(dragArea(start, 'move', 0.6, -0.5, null, 1)).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    const wider = dragArea(start, 'e', 0.9, 0, null, 1);
    expect(wider.x + wider.w).toBe(1);
  });

  it('holds its shape when a ratio is picked', () => {
    const square = dragArea({ x: 0, y: 0, w: 0.5, h: 0.5 }, 'se', 0.2, 0, 1, 1);
    expect(square.w).toBeCloseTo(0.7);
    expect(square.h).toBeCloseTo(0.7);
  });
});

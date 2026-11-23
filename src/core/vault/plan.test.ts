import { describe, expect, it } from 'vitest';
import { movedPath, withFolderMove } from './plan';

describe('files in folders renamed with their pages', () => {
  it('finds a file in a renamed folder, and leaves others alone', () => {
    const moves = withFolderMove([], 'Recipes', 'Cooking');
    expect(movedPath(moves, 'Recipes/attachments/x.png')).toBe('Cooking/attachments/x.png');
    expect(movedPath(moves, 'Recipes Old/x.png')).toBe('Recipes Old/x.png');
    expect(movedPath(moves, 'attachments/x.png')).toBe('attachments/x.png');
  });

  it('follows a folder renamed more than once, and one moved back', () => {
    let moves = withFolderMove([], 'Recipes', 'Cooking');
    moves = withFolderMove(moves, 'Cooking', 'Food/Cooking');
    expect(movedPath(moves, 'Recipes/attachments/x.png')).toBe('Food/Cooking/attachments/x.png');
    expect(movedPath(moves, 'Cooking/attachments/y.png')).toBe('Food/Cooking/attachments/y.png');
    moves = withFolderMove(moves, 'Food/Cooking', 'Recipes');
    expect(movedPath(moves, 'Recipes/attachments/x.png')).toBe('Recipes/attachments/x.png');
  });

  it('takes the deepest renamed folder', () => {
    let moves = withFolderMove([], 'A', 'B');
    moves = withFolderMove(moves, 'B/inner', 'C');
    expect(movedPath(moves, 'A/inner/x.png')).toBe('C/x.png');
    expect(movedPath(moves, 'A/other/x.png')).toBe('B/other/x.png');
  });
});

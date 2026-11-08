import { describe, expect, it } from 'vitest';
import { pastedKind } from './PasteMenu';

describe('pasting a link', () => {
  it('knows what a pasted address could be', () => {
    expect(pastedKind('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
    expect(pastedKind('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
    expect(pastedKind('https://example.org/cat.png')).toBe('picture');
    expect(pastedKind('https://example.org/about')).toBe('link');
    expect(pastedKind('/home/me/Videos/talk.mp4')).toBe('local');
    expect(pastedKind('C:\\Users\\me\\Music\\song.mp3')).toBe('local');
    expect(pastedKind('file:///home/me/clip.webm')).toBe('local');
    expect(pastedKind('/home/me/notes.txt')).toBeNull();
    expect(pastedKind('two words')).toBeNull();
  });
});

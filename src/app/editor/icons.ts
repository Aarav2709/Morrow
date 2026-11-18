import { createLucideIcon } from 'lucide-react';

// a list counted a, b, c. lucide only has the numbered one, this is drawn the same way with letters. the letters are drawn a little smaller and thinner than the lines and the lines spread out, so a, b and c
// each have room at the size of a menu icon
export const ListLettered = createLucideIcon('list-lettered', [
  ['path', { d: 'M10 5h11', key: 'line-1' }],
  ['path', { d: 'M10 12h11', key: 'line-2' }],
  ['path', { d: 'M10 19h11', key: 'line-3' }],
  ['circle', { cx: '4.5', cy: '5', r: '1.3', strokeWidth: 1.75, key: 'a-bowl' }],
  ['path', { d: 'M5.8 3.7v2.6', strokeWidth: 1.75, key: 'a-stem' }],
  ['path', { d: 'M3.2 9.6v4.1', strokeWidth: 1.75, key: 'b-stem' }],
  ['circle', { cx: '4.5', cy: '12.4', r: '1.3', strokeWidth: 1.75, key: 'b-bowl' }],
  ['path', { d: 'M5.42 18.08a1.3 1.3 0 1 0 0 1.84', strokeWidth: 1.75, key: 'c' }],
]);

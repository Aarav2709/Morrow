import { createLucideIcon } from 'lucide-react';

// a list counted a, b, c. lucide only has the numbered one, this is drawn the same way with letters
export const ListLettered = createLucideIcon('list-lettered', [
  ['path', { d: 'M11 6h10', key: 'line-1' }],
  ['path', { d: 'M11 12h10', key: 'line-2' }],
  ['path', { d: 'M11 18h10', key: 'line-3' }],
  ['circle', { cx: '4.75', cy: '6.25', r: '1.75', key: 'a-bowl' }],
  ['path', { d: 'M6.5 4.5v3.5', key: 'a-stem' }],
  ['path', { d: 'M3 9.5v4.5', key: 'b-stem' }],
  ['circle', { cx: '4.75', cy: '12.25', r: '1.75', key: 'b-bowl' }],
  ['path', { d: 'M5.9 16.9a1.75 1.75 0 1 0 0 2.7', key: 'c' }],
]);

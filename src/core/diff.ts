// line by line differences between two texts, for comparing a page with an earlier version of it
export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // common start and end are cut first, most edits touch a small part of a page
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const head = a.slice(0, start).map((text): DiffLine => ({ kind: 'same', text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ kind: 'same', text }));
  if (midA.length * midB.length > MAX_CELLS) {
    return [
      ...head,
      ...midA.map((text): DiffLine => ({ kind: 'removed', text })),
      ...midB.map((text): DiffLine => ({ kind: 'added', text })),
      ...tail,
    ];
  }
  // longest common subsequence over the changed middle
  const rows = midA.length + 1;
  const cols = midB.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        midA[i] === midB[j]
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      middle.push({ kind: 'same', text: midA[i]! });
      i++;
      j++;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!)
      middle.push({ kind: 'removed', text: midA[i++]! });
    else middle.push({ kind: 'added', text: midB[j++]! });
  }
  while (i < midA.length) middle.push({ kind: 'removed', text: midA[i++]! });
  while (j < midB.length) middle.push({ kind: 'added', text: midB[j++]! });
  return [...head, ...middle, ...tail];
}

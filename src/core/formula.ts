// formula properties: a small expression language in the style of notion's, read and run without eval
//   prop("Price") * prop("Count")
//   if(prop("Done"), "✅", "⏳")
//   dateBetween(prop("Due"), today(), "days")
export type FormulaValue = number | string | boolean | null;

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string };

type Expr =
  | { kind: 'literal'; value: FormulaValue }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'unary'; op: string; arg: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr };

const MAX_LENGTH = 2000;
const MAX_DEPTH = 64;
const OPERATORS = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '<',
  '>',
  '!',
  '(',
  ')',
  ',',
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(source.slice(i));
      if (!match) throw new Error(`Unexpected “${char}”`);
      tokens.push({ kind: 'number', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (char === '"' || char === "'") {
      let value = '';
      let j = i + 1;
      for (; j < source.length && source[j] !== char; j++) {
        if (source[j] === '\\' && j + 1 < source.length) j++;
        value += source[j];
      }
      if (j >= source.length) throw new Error('A piece of text is missing its closing quote');
      tokens.push({ kind: 'string', value });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
      tokens.push({ kind: 'name', value: match[0] });
      i += match[0].length;
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (!op) throw new Error(`Unexpected “${char}”`);
    tokens.push({ kind: 'op', value: op });
    i += op.length;
  }
  return tokens;
}

// precedence climbing, lowest first
const LEVELS = [
  ['||', 'or'],
  ['&&', 'and'],
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['+', '-'],
  ['*', '/', '%'],
  ['^'],
];

export function parseFormula(source: string): Expr {
  if (source.length > MAX_LENGTH) throw new Error('This formula is too long');
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (value: string) => {
    const token = peek();
    return (
      !!token &&
      ((token.kind === 'op' && token.value === value) || (token.kind === 'name' && token.value === value))
    );
  };
  const expect = (value: string) => {
    if (!isOp(value)) throw new Error(`Expected “${value}”`);
    pos++;
  };
  const level = (index: number, depth: number): Expr => {
    if (depth > MAX_DEPTH) throw new Error('This formula is nested too deeply');
    if (index === LEVELS.length) return unary(depth);
    let left = level(index + 1, depth + 1);
    for (;;) {
      const op = LEVELS[index]!.find(isOp);
      if (!op) return left;
      pos++;
      const right = index === LEVELS.length - 1 ? level(index, depth + 1) : level(index + 1, depth + 1);
      left = { kind: 'binary', op: op === 'or' ? '||' : op === 'and' ? '&&' : op, left, right };
    }
  };
  const unary = (depth: number): Expr => {
    if (isOp('-') || isOp('!') || isOp('not')) {
      const op = peek()!.value === 'not' ? '!' : String(peek()!.value);
      pos++;
      return { kind: 'unary', op, arg: unary(depth + 1) };
    }
    return primary(depth);
  };
  const primary = (depth: number): Expr => {
    const token = peek();
    if (!token) throw new Error('The formula ends too early');
    pos++;
    if (token.kind === 'number' || token.kind === 'string') return { kind: 'literal', value: token.value };
    if (token.kind === 'op' && token.value === '(') {
      const inner = level(0, depth + 1);
      expect(')');
      return inner;
    }
    if (token.kind === 'name') {
      if (token.value === 'true' || token.value === 'false')
        return { kind: 'literal', value: token.value === 'true' };
      if (!isOp('(')) throw new Error(`“${token.value}” needs brackets, like ${token.value}()`);
      pos++;
      const args: Expr[] = [];
      if (!isOp(')')) {
        do {
          args.push(level(0, depth + 1));
        } while (isOp(',') && ++pos);
      }
      expect(')');
      return { kind: 'call', name: token.value.toLowerCase(), args };
    }
    throw new Error(`Unexpected “${token.value}”`);
  };
  const expr = level(0, 0);
  if (pos < tokens.length) throw new Error(`Unexpected “${String(tokens[pos]!.value)}”`);
  return expr;
}

const toNumber = (value: FormulaValue): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return NaN;
};
const toText = (value: FormulaValue): string =>
  value === null ? '' : typeof value === 'number' ? String(Math.round(value * 1e10) / 1e10) : String(value);
const truthy = (value: FormulaValue): boolean =>
  value !== null && value !== false && value !== 0 && value !== '';

const DAY = 86_400_000;
function toDate(value: FormulaValue): Date | null {
  if (typeof value === 'number') return new Date(value);
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
const dateText = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const UNITS: Record<string, number> = {
  days: DAY,
  day: DAY,
  weeks: 7 * DAY,
  week: 7 * DAY,
  hours: 3_600_000,
  hour: 3_600_000,
};

const FUNCTIONS: Record<string, (args: FormulaValue[], now: Date) => FormulaValue> = {
  if: ([test, yes = null, no = null]) => (truthy(test ?? null) ? yes : no),
  empty: ([value = null]) => !truthy(value),
  round: ([value = null, places = 0]) => {
    const factor = 10 ** Math.max(0, Math.min(10, toNumber(places)));
    return Math.round(toNumber(value) * factor) / factor;
  },
  floor: ([value = null]) => Math.floor(toNumber(value)),
  ceil: ([value = null]) => Math.ceil(toNumber(value)),
  abs: ([value = null]) => Math.abs(toNumber(value)),
  sqrt: ([value = null]) => Math.sqrt(toNumber(value)),
  min: (args) => Math.min(...args.map(toNumber)),
  max: (args) => Math.max(...args.map(toNumber)),
  sum: (args) =>
    args.reduce<number>((total, value) => total + (Number.isNaN(toNumber(value)) ? 0 : toNumber(value)), 0),
  length: ([value = null]) => toText(value).length,
  concat: (args) => args.map(toText).join(''),
  join: ([separator = '', ...args]) => args.map(toText).filter(Boolean).join(toText(separator)),
  upper: ([value = null]) => toText(value).toUpperCase(),
  lower: ([value = null]) => toText(value).toLowerCase(),
  contains: ([text = null, part = null]) => toText(text).toLowerCase().includes(toText(part).toLowerCase()),
  replace: ([text = null, from = null, to = null]) => toText(text).split(toText(from)).join(toText(to)),
  slice: ([text = null, start = 0, end = null]) =>
    toText(text).slice(toNumber(start), end === null ? undefined : toNumber(end)),
  number: ([value = null]) => toNumber(value),
  text: ([value = null]) => toText(value),
  format: ([value = null]) => toText(value),
  now: (_args, now) => now.getTime(),
  today: (_args, now) => dateText(now),
  dateadd: ([date = null, amount = 0, unit = 'days']) => {
    const start = toDate(date);
    if (!start) return null;
    const step = toText(unit).toLowerCase();
    const result = new Date(start);
    if (step.startsWith('month')) result.setMonth(result.getMonth() + toNumber(amount));
    else if (step.startsWith('year')) result.setFullYear(result.getFullYear() + toNumber(amount));
    else result.setTime(result.getTime() + toNumber(amount) * (UNITS[step] ?? DAY));
    return dateText(result);
  },
  datebetween: ([a = null, b = null, unit = 'days']) => {
    const first = toDate(a);
    const second = toDate(b);
    if (!first || !second) return null;
    return Math.trunc((first.getTime() - second.getTime()) / (UNITS[toText(unit).toLowerCase()] ?? DAY));
  },
  year: ([date = null]) => toDate(date)?.getFullYear() ?? null,
  month: ([date = null]) => (toDate(date) ? toDate(date)!.getMonth() + 1 : null),
  day: ([date = null]) => toDate(date)?.getDate() ?? null,
};

export const FORMULA_FUNCTIONS = ['prop', ...Object.keys(FUNCTIONS)];

export function evaluateFormula(
  expr: Expr,
  prop: (name: string) => FormulaValue,
  now = new Date(),
): FormulaValue {
  let steps = 0;
  const run = (node: Expr): FormulaValue => {
    if (++steps > 10_000) throw new Error('This formula takes too long');
    switch (node.kind) {
      case 'literal':
        return node.value;
      case 'unary': {
        const value = run(node.arg);
        return node.op === '!' ? !truthy(value) : -toNumber(value);
      }
      case 'binary': {
        if (node.op === '&&') return truthy(run(node.left)) && truthy(run(node.right));
        if (node.op === '||') return truthy(run(node.left)) || truthy(run(node.right));
        const left = run(node.left);
        const right = run(node.right);
        switch (node.op) {
          case '+':
            return typeof left === 'string' || typeof right === 'string'
              ? toText(left) + toText(right)
              : toNumber(left) + toNumber(right);
          case '-':
            return toNumber(left) - toNumber(right);
          case '*':
            return toNumber(left) * toNumber(right);
          case '/':
            return toNumber(right) === 0 ? null : toNumber(left) / toNumber(right);
          case '%':
            return toNumber(left) % toNumber(right);
          case '^':
            return toNumber(left) ** toNumber(right);
          case '==':
            return toText(left) === toText(right);
          case '!=':
            return toText(left) !== toText(right);
          default: {
            const order =
              typeof left === 'number' || typeof right === 'number'
                ? toNumber(left) - toNumber(right)
                : toText(left).localeCompare(toText(right));
            return node.op === '<'
              ? order < 0
              : node.op === '<='
                ? order <= 0
                : node.op === '>'
                  ? order > 0
                  : order >= 0;
          }
        }
      }
      case 'call': {
        if (node.name === 'prop') {
          const name = node.args[0] ? toText(run(node.args[0])) : '';
          return prop(name);
        }
        const fn = FUNCTIONS[node.name];
        if (!fn) throw new Error(`There is no function called ${node.name}()`);
        // if only runs the branch it needs
        if (node.name === 'if') {
          const test = node.args[0] ? run(node.args[0]) : null;
          const branch = truthy(test) ? node.args[1] : node.args[2];
          return branch ? run(branch) : null;
        }
        return fn(node.args.map(run), now);
      }
    }
  };
  const result = run(expr);
  return typeof result === 'number' && !Number.isFinite(result) ? null : result;
}

const cache = new Map<string, Expr | Error>();

// runs a formula's source, a mistake in it becomes a message instead of a value
export function computeFormula(
  source: string,
  prop: (name: string) => FormulaValue,
  now = new Date(),
): { value: FormulaValue; error: string | null } {
  if (!source.trim()) return { value: null, error: null };
  let parsed = cache.get(source);
  if (!parsed) {
    try {
      parsed = parseFormula(source);
    } catch (error) {
      parsed = error instanceof Error ? error : new Error(String(error));
    }
    if (cache.size > 500) cache.clear();
    cache.set(source, parsed);
  }
  if (parsed instanceof Error) return { value: null, error: parsed.message };
  try {
    return { value: evaluateFormula(parsed, prop, now), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

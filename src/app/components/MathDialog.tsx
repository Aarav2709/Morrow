import katex from 'katex';
import { useMemo, useRef, useState } from 'react';
import { formatShortcut } from '../actions';
import { openHref } from '../editor/EditorMenus';
import { useTranslation } from '../i18n';
import { closeDialog } from '../ui';
import { Dialog } from './primitives';

interface Snippet {
  // what goes into the formula, the first {} is where the cursor lands
  insert: string;
  // how its button draws it
  show: string;
}

const STRUCTURES: Snippet[] = [
  { insert: '\\frac{}{}', show: '\\frac{a}{b}' },
  { insert: '\\sqrt{}', show: '\\sqrt{x}' },
  { insert: '^{}', show: 'x^{n}' },
  { insert: '_{}', show: 'x_{i}' },
  { insert: '\\sum_{i=1}^{n} ', show: '\\sum_{i=1}^{n}' },
  { insert: '\\int_{a}^{b} ', show: '\\int_{a}^{b}' },
  { insert: '\\lim_{x \\to \\infty} ', show: '\\lim_{x \\to \\infty}' },
  { insert: '\\left( {} \\right)', show: '\\left( x \\right)' },
  { insert: '\\vec{}', show: '\\vec{v}' },
  { insert: '\\overline{}', show: '\\overline{z}' },
  { insert: '\\text{}', show: '\\text{abc}' },
  {
    insert: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
    show: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
  },
  {
    insert: '\\begin{cases} {} & \\text{if } x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}',
    show: '\\begin{cases} a \\\\ b \\end{cases}',
  },
];

const symbols = (names: string[]): Snippet[] =>
  names.map((name) => ({ insert: `\\${name} `, show: `\\${name}` }));

const GREEK = symbols([
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'theta',
  'lambda',
  'mu',
  'pi',
  'rho',
  'sigma',
  'tau',
  'phi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Sigma',
  'Phi',
  'Omega',
]);

const SYMBOLS = symbols([
  'times',
  'div',
  'pm',
  'cdot',
  'leq',
  'geq',
  'neq',
  'approx',
  'equiv',
  'infty',
  'to',
  'Rightarrow',
  'Leftrightarrow',
  'in',
  'notin',
  'subset',
  'cup',
  'cap',
  'forall',
  'exists',
  'partial',
  'nabla',
  'angle',
  'circ',
]);

const draw = (latex: string, displayMode: boolean) =>
  // katex output is plain markup, it never runs scripts or loads anything
  katex.renderToString(latex, { throwOnError: false, displayMode, strict: false, trust: false });

// the formula as it will look, or why it can't be read
function render(latex: string, displayMode: boolean): { html: string | null; error: string | null } {
  if (!latex.trim()) return { html: null, error: null };
  try {
    return {
      html: katex.renderToString(latex, { throwOnError: true, displayMode, strict: false, trust: false }),
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.replace(/^KaTeX parse error: /, '') : String(error);
    return { html: draw(latex, displayMode), error: message };
  }
}

// edits a formula with a live preview, a palette of common pieces and a choice of inline or on its own line
export function MathDialog({
  value,
  block,
  onSave,
  onCancel,
}: {
  value: string;
  block: boolean;
  onSave: (latex: string, block: boolean) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  const [onOwnLine, setOnOwnLine] = useState(block);
  const [group, setGroup] = useState<'structures' | 'greek' | 'symbols'>('structures');
  const input = useRef<HTMLTextAreaElement>(null);
  const preview = useMemo(() => render(text, onOwnLine), [text, onOwnLine]);
  const snippets = group === 'structures' ? STRUCTURES : group === 'greek' ? GREEK : SYMBOLS;
  const buttons = useMemo(() => snippets.map((snippet) => draw(snippet.show, false)), [snippets]);

  const cancel = () => {
    closeDialog();
    onCancel?.();
  };
  const save = () => {
    closeDialog();
    onSave(text, onOwnLine);
  };
  // puts a piece in at the cursor, wrapping any selected text in its first braces
  const insert = (snippet: Snippet) => {
    const area = input.current;
    const start = area?.selectionStart ?? text.length;
    const end = area?.selectionEnd ?? text.length;
    const selected = text.slice(start, end);
    const hole = snippet.insert.indexOf('{}');
    const piece =
      hole >= 0
        ? `${snippet.insert.slice(0, hole + 1)}${selected}${snippet.insert.slice(hole + 1)}`
        : snippet.insert;
    const next = text.slice(0, start) + piece + text.slice(end);
    const caret = hole >= 0 ? start + hole + 1 + selected.length : start + piece.length;
    setText(next);
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(caret, caret);
    });
  };

  return (
    <Dialog
      title={t('math.editTitle')}
      onClose={cancel}
      size="large"
      className="math-dialog"
      footer={
        <>
          <button
            type="button"
            className="link-button dialog-hint"
            onClick={() => openHref('https://katex.org/docs/supported')}
          >
            {t('math.learnMore')}
          </button>
          <span className="muted small">{t('math.saveHint', { shortcut: formatShortcut('Mod+Enter') })}</span>
          <button type="button" className="button" onClick={cancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="button primary" onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div
        className={`math-preview${preview.html ? '' : ' is-empty'}${onOwnLine ? ' is-block' : ''}`}
        aria-label={t('math.previewLabel')}
      >
        {preview.html ? (
          <div dangerouslySetInnerHTML={{ __html: preview.html }} />
        ) : (
          <span className="muted">{t('math.previewEmpty')}</span>
        )}
      </div>
      {preview.error && <p className="math-error">{preview.error}</p>}
      <textarea
        ref={input}
        className="text-input math-input"
        data-autofocus
        spellCheck={false}
        rows={3}
        aria-label={t('math.latexLabel')}
        placeholder={t('math.placeholder')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="math-toolbar">
        <div className="segmented" role="radiogroup" aria-label={t('math.showAs')}>
          {(
            [
              [false, t('math.inSentence')],
              [true, t('math.ownLine')],
            ] as const
          ).map(([option, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={onOwnLine === option}
              className={onOwnLine === option ? 'is-active' : ''}
              onClick={() => setOnOwnLine(option)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="math-groups" role="tablist">
          {(['structures', 'greek', 'symbols'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={group === name}
              className={group === name ? 'is-active' : ''}
              onClick={() => setGroup(name)}
            >
              {t(`math.${name}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="math-palette">
        {snippets.map((snippet, index) => (
          <button
            key={snippet.insert}
            type="button"
            className="math-piece"
            title={snippet.insert.trim()}
            aria-label={t('math.insert', { name: snippet.show })}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insert(snippet)}
            dangerouslySetInnerHTML={{ __html: buttons[index]! }}
          />
        ))}
      </div>
    </Dialog>
  );
}

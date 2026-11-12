import type { Editor } from '@tiptap/core';
import { findParentNode, getMarkRange } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { BubbleMenuProps } from '@tiptap/react/menus';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronRight,
  Columns3,
  Code,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Ellipsis,
  Heading,
  Heading1,
  RemoveFormatting,
  Sigma,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ImageIcon,
  Info,
  Italic,
  Link2,
  Link2Off,
  List,
  ListChecks,
  ListOrdered,
  Palette,
  Pencil,
  Pilcrow,
  Quote,
  Smile,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  CaseLower,
  CaseUpper,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pageIdFromHref } from '../../core/links';
import { COLORS } from '../../core/model';
import type { ColorName } from '../../core/model';
import { formatShortcut } from '../actions';
import { Menu } from '../components/Menu';
import { t } from '../i18n';
import type { MenuEntry } from '../components/Menu';
import { copyImageFile, downloadFile } from '../platform/attachments';
import { copyText, desktop, openExternal } from '../platform/desktop';
import { attachSelection } from '../assistant/selection';
import { setPreferences, usePreferences } from '../platform/preferences';
import { activeRoute, openPage } from '../router';
import { moveBlock } from './BlockHandle';
import { editMathNear } from './Extras';
import type { BlockMenuRequest } from './BlockHandle';
import { clearBlockSelection, selectedBlocks } from './BlockSelect';
import type { BlockRange } from './BlockSelect';
import { turnListItem } from './turnInto';
import type { TurnTarget } from './turnInto';
import { openDialog, toast } from '../ui';
import { getSession } from '../workspace';
import { colorLabel } from '../i18n/labels';

function ToolButton({
  label,
  icon: Icon,
  active,
  onClick,
  shortcut,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      className={`tool-button${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${formatShortcut(shortcut)})` : label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}

// a file or folder on the computer: ./ and ../ from the page's own folder, ~/ from the home folder, a full
// path or a file:// address. a path like Reading/paper.pdf, whose first folder has no dot in it the way a
// web address would, is one too
const LOCAL_HREF = /^(file:|\.{1,2}[/\\]|~[/\\]|\/|[a-z]:[/\\]|[^./\\:#?]+[/\\])/i;

export function normalizeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (LOCAL_HREF.test(value)) return value;
  if (/^(https?:|mailto:|#\/page\/)/i.test(value)) return value;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(value)) return `mailto:${value}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return `https://${value}`;
}

export function openHref(href: string): void {
  const pageId = pageIdFromHref(href);
  if (pageId) openPage(pageId);
  else if (LOCAL_HREF.test(href)) void openLocal(href);
  else openExternal(href);
}

async function openLocal(href: string): Promise<void> {
  const route = activeRoute();
  const pagePath = route.name === 'page' ? getSession().pathOf(route.id) : null;
  const opened = await (desktop?.vault?.openLink?.(href, pagePath) ?? Promise.resolve(false)).catch(
    () => false,
  );
  if (!opened) toast(t('editor.fileNotFound', { path: href }), { tone: 'error' });
}

function LinkInput({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [value, setValue] = useState(() => String(editor.getAttributes('link').href ?? ''));
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const apply = () => {
    if (!value.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      onDone();
      return;
    }
    const href = normalizeHref(value);
    if (!href) {
      setError(true);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    onDone();
  };
  return (
    <form
      className="link-form"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <input
        ref={inputRef}
        className={`link-input${error ? ' is-invalid' : ''}`}
        placeholder={t('editor.linkPlaceholder')}
        aria-label={t('editor.linkAddressAria')}
        aria-invalid={error}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            editor.commands.focus();
            onDone();
          }
        }}
      />
      <button type="submit" className="link-apply">
        {t('editor.apply')}
      </button>
    </form>
  );
}

// a word picked by a right click belongs to the system's menu, with its spelling suggestions, so the
// formatting bar stays away until the next left click or key
const rightClicked = new WeakSet<Editor>();
export function noteMouseButton(editor: Editor, event: MouseEvent | KeyboardEvent): void {
  if (event instanceof MouseEvent && event.button === 2) rightClicked.add(editor);
  else rightClicked.delete(editor);
}

// bubble menu props must keep their identity, new objects make tiptap dispatch and rerender in a loop
const showFormatting: BubbleMenuProps['shouldShow'] = ({ editor, state, from, to }) => {
  if (!editor.isEditable || from === to || state.selection instanceof NodeSelection) return false;
  if (rightClicked.has(editor)) return false;
  // whole blocks picked in the margin have the block menu instead
  return !editor.isActive('codeBlock') && !selectedBlocks(state);
};
// a link whose card was used, opened, copied or edited, keeps it closed until the cursor leaves the link
const dismissedLinks = new WeakMap<Editor, number>();
function linkStart(editor: Editor): number | null {
  const type = editor.schema.marks.link;
  if (!type) return null;
  return getMarkRange(editor.state.selection.$from, type)?.from ?? null;
}
function dismissLink(editor: Editor): void {
  const start = linkStart(editor);
  if (start === null) return;
  dismissedLinks.set(editor, start);
  // an empty step makes the menu look again, and hide
  editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
}
const showLink: BubbleMenuProps['shouldShow'] = ({ editor, view, from, to }) => {
  const start = from === to && editor.isActive('link') ? linkStart(editor) : null;
  const dismissed = dismissedLinks.get(editor);
  if (dismissed !== undefined && dismissed !== start) dismissedLinks.delete(editor);
  return start !== null && dismissed !== start && view.hasFocus();
};
const showTable: BubbleMenuProps['shouldShow'] = ({ editor, from, to }) =>
  editor.isEditable && from === to && editor.isActive('table');
const TABLE_OPTIONS = { placement: 'top-start', offset: 8, flip: false, shift: { padding: 8 } } as const;

function useMarks(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      highlight: current.isActive('highlight'),
      link: current.isActive('link'),
      heading: headingLevel(current) !== null,
      href: String(current.getAttributes('link').href ?? ''),
    }),
  });
}

// the nine colours for text and for highlighting, the same set notion, affine and select options use
function ColorPanel({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const current = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      text: (e.getAttributes('textColor').color as ColorName | undefined) ?? null,
      bg: e.isActive('highlight')
        ? ((e.getAttributes('highlight').color as ColorName | undefined) ?? 'yellow')
        : null,
    }),
  });
  // a colour is picked, then the menu goes back to bold, italic and the rest for the same words
  const pick = (kind: 'text' | 'bg', color: ColorName | null) => {
    if (color) setPreferences({ lastColor: { kind, color } });
    if (kind === 'text') editor.chain().focus().setTextColor(color).run();
    else editor.chain().focus().setHighlightColor(color).run();
    onDone();
  };
  const row = (kind: 'text' | 'bg') => (
    <div
      className="color-row"
      role="group"
      aria-label={kind === 'text' ? t('editor.textColour') : t('editor.highlight')}
    >
      <button
        type="button"
        className={`color-dot default${(kind === 'text' ? current.text : current.bg) === null ? ' is-active' : ''}`}
        title={kind === 'text' ? t('editor.defaultTextColor') : t('editor.noHighlight')}
        aria-label={kind === 'text' ? t('editor.defaultTextColor') : t('editor.noHighlight')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => pick(kind, null)}
      >
        {kind === 'text' ? 'A' : ''}
      </button>
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-dot ${kind}-${color}${(kind === 'text' ? current.text : current.bg) === color ? ' is-active' : ''}`}
          title={
            kind === 'bg' ? t('editor.colourHighlight', { colour: colorLabel(color) }) : colorLabel(color)
          }
          aria-label={
            kind === 'bg'
              ? t('editor.colourHighlight', { colour: colorLabel(color) })
              : t('editor.colourText', { colour: colorLabel(color) })
          }
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => pick(kind, color)}
        >
          {kind === 'text' ? 'A' : ''}
        </button>
      ))}
    </div>
  );
  return (
    <div className="color-panel" onKeyDown={(event) => event.key === 'Escape' && onDone()}>
      <span className="color-panel-label">{t('slash.items.text.title')}</span>
      {row('text')}
      <span className="color-panel-label">{t('editor.highlight')}</span>
      {row('bg')}
    </div>
  );
}

// the picked words in capitals or small letters, keeping their formatting. each run of text is changed on
// its own so bold, links and colours stay where they were
// a heading from the toolbar. in a toggle's title the level goes on the title, which makes a toggle heading
export function setHeading(editor: Editor, level: 1 | 2 | 3 | 4 | 5 | 6): void {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name === 'detailsSummary') {
    const same = $from.parent.attrs.level === level;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup($from.before(), undefined, {
        ...$from.parent.attrs,
        level: same ? null : level,
      }),
    );
    editor.commands.focus();
    return;
  }
  editor.chain().focus().toggleHeading({ level }).run();
}

const headingLevel = (editor: Editor): number | null => {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name === 'detailsSummary') return Number($from.parent.attrs.level) || null;
  return $from.parent.type.name === 'heading' ? Number($from.parent.attrs.level) : null;
};

export function changeCase(editor: Editor, change: (text: string) => string): void {
  const { selection } = editor.state;
  const { tr } = editor.state;
  // cells picked across a table are a range each, all of them change, not only the first
  for (const range of selection.ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText || !node.text) return;
      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);
      const text = node.text.slice(start - pos, end - pos);
      const changed = change(text);
      // a letter that grows into two, like ß into SS, would move what follows, so those keep their case
      if (changed !== text && changed.length === text.length) tr.insertText(changed, start, end);
    });
  }
  if (!tr.docChanged) return;
  // text keeps its length, so the same selection still fits, cells and all
  tr.setSelection(selection.map(tr.doc, tr.mapping));
  editor.view.dispatch(tr);
  editor.commands.focus();
}

export function FormattingMenu({
  editor,
  pageId,
  onBlockMenu,
}: {
  editor: Editor;
  pageId?: string;
  onBlockMenu?: (request: BlockMenuRequest) => void;
}) {
  const [editingLink, setEditingLink] = useState(false);
  const [coloring, setColoring] = useState(false);
  const [headings, setHeadings] = useState(false);
  const marks = useMarks(editor);
  const { assistant } = usePreferences();
  const [options] = useState(
    () =>
      ({
        placement: 'top',
        offset: 8,
        flip: true,
        shift: { padding: 8 },
        onHide: () => {
          setEditingLink(false);
          setColoring(false);
          setHeadings(false);
        },
      }) as const,
  );

  useEffect(() => {
    // capture the node now, the editor can be destroyed before this cleanup runs
    const dom = editor.view.dom;
    const open = () => setEditingLink(true);
    const colour = () => setColoring(true);
    dom.addEventListener('morrow:edit-link', open);
    dom.addEventListener('morrow:colour', colour);
    return () => {
      dom.removeEventListener('morrow:edit-link', open);
      dom.removeEventListener('morrow:colour', colour);
    };
  }, [editor]);

  // headings make no sense inside a table's cells, so the button is left out there
  const inTable = useEditorState({ editor, selector: ({ editor: e }) => e.isActive('table') });

  return (
    <BubbleMenu editor={editor} pluginKey="formattingMenu" options={options} shouldShow={showFormatting}>
      <div className="toolbar popover" role="toolbar" aria-label={t('editor.formattingAria')}>
        {editingLink ? (
          <LinkInput editor={editor} onDone={() => setEditingLink(false)} />
        ) : coloring ? (
          <ColorPanel editor={editor} onDone={() => setColoring(false)} />
        ) : headings ? (
          <HeadingPanel editor={editor} onDone={() => setHeadings(false)} />
        ) : (
          <>
            <ToolButton label={t('editor.colour')} icon={Palette} onClick={() => setColoring(true)} />
            <span className="toolbar-divider" />
            <ToolButton
              label={t('editor.bold')}
              icon={Bold}
              shortcut="Mod+B"
              active={marks.bold}
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
            <ToolButton
              label={t('editor.italic')}
              icon={Italic}
              shortcut="Mod+I"
              active={marks.italic}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
            <ToolButton
              label={t('editor.underline')}
              icon={Underline}
              shortcut="Mod+U"
              active={marks.underline}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            />
            <ToolButton
              label={t('editor.strikethrough')}
              icon={Strikethrough}
              shortcut="Mod+Shift+S"
              active={marks.strike}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            />
            <ToolButton
              label={t('editor.uppercase')}
              icon={CaseUpper}
              onClick={() => changeCase(editor, (text) => text.toLocaleUpperCase())}
            />
            <ToolButton
              label={t('editor.lowercase')}
              icon={CaseLower}
              onClick={() => changeCase(editor, (text) => text.toLocaleLowerCase())}
            />
            <span className="toolbar-divider" />
            <ToolButton
              label={t('editor.link')}
              icon={Link2}
              shortcut="Mod+K"
              active={marks.link}
              onClick={() => setEditingLink(true)}
            />
            <ToolButton
              label={t('editor.code')}
              icon={Code}
              shortcut="Mod+E"
              active={marks.code}
              onClick={() => editor.chain().focus().toggleCode().run()}
            />
            <ToolButton label={t('editor.equation')} icon={Sigma} onClick={() => toEquation(editor)} />
            {!inTable && (
              <ToolButton
                label={t('editor.heading')}
                icon={Heading}
                active={marks.heading}
                onClick={() => setHeadings(true)}
              />
            )}
            <ToolButton
              label={t('editor.clearFormatting')}
              icon={RemoveFormatting}
              onClick={() => editor.chain().focus().unsetAllMarks().run()}
            />
            {/* only while the assistant is turned on, a workspace without it shows no trace of it */}
            {assistant && desktop?.assistant && pageId && (
              <ToolButton
                label={t('editor.askAssistant')}
                icon={Sparkles}
                onClick={() => {
                  // the highlighted words go to the assistant, which changes only those
                  if (attachSelection(editor, pageId)) setPreferences({ assistantOpen: true });
                }}
              />
            )}
            {onBlockMenu && (
              <>
                <span className="toolbar-divider" />
                <ToolButton
                  label={t('editor.moreOptions')}
                  icon={Ellipsis}
                  onClick={(event) => {
                    const request = selectionBlocks(editor);
                    if (request)
                      onBlockMenu({ ...request, rect: event.currentTarget.getBoundingClientRect() });
                  }}
                />
              </>
            )}
          </>
        )}
      </div>
    </BubbleMenu>
  );
}

// the six heading levels from the toolbar, with text to take a heading back to a line
function HeadingPanel({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const level = useEditorState({ editor, selector: ({ editor: e }) => headingLevel(e) });
  const icons = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6] as const;
  return (
    <div className="heading-panel" onKeyDown={(event) => event.key === 'Escape' && onDone()}>
      <ToolButton
        label={t('slash.items.text.title')}
        icon={Pilcrow}
        active={level === null}
        onClick={() => {
          if (level !== null) setHeading(editor, level as 1 | 2 | 3 | 4 | 5 | 6);
          onDone();
        }}
      />
      {icons.map((icon, index) => {
        const value = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6;
        return (
          <ToolButton
            key={value}
            label={t(`slash.items.h${value}.title`)}
            icon={icon}
            active={level === value}
            onClick={() => {
              if (level !== value) setHeading(editor, value);
              onDone();
            }}
          />
        );
      })}
    </div>
  );
}

// the picked words become an inline equation written in latex, then it opens for editing
function toEquation(editor: Editor): void {
  const { from, to, empty } = editor.state.selection;
  const math = editor.schema.nodes.inlineMath;
  if (!math) return;
  const latex = empty ? '' : editor.state.doc.textBetween(from, to, ' ').trim();
  editor.chain().focus().insertContentAt({ from, to }, { type: 'inlineMath', attrs: { latex } }).run();
  editMathNear(editor, from);
}

// the blocks the selected words are in, for the turn into menu the toolbar opens
function selectionBlocks(editor: Editor): Omit<BlockMenuRequest, 'rect'> | null {
  const { $from, $to } = editor.state.selection;
  if ($from.depth < 1 || $to.depth < 1) return null;
  // words in one block turn that block, or the list item they are in
  if ($from.before(1) === $to.before(1)) {
    for (let depth = $from.depth; depth > 0; depth--)
      if (['listItem', 'taskItem'].includes($from.node(depth).type.name)) return { pos: $from.before(depth) };
    return { pos: $from.before(1) };
  }
  return { pos: $from.before(1), range: { from: $from.before(1), to: $to.after(1) } };
}

export function LinkMenu({ editor }: { editor: Editor }) {
  const [editing, setEditing] = useState(false);
  const { href } = useMarks(editor);
  const [options] = useState(
    () => ({ placement: 'bottom-start', offset: 6, flip: true, onHide: () => setEditing(false) }) as const,
  );
  return (
    <BubbleMenu editor={editor} pluginKey="linkMenu" options={options} shouldShow={showLink}>
      <div className="toolbar popover link-popover">
        {editing ? (
          <LinkInput
            editor={editor}
            onDone={() => {
              setEditing(false);
              dismissLink(editor);
            }}
          />
        ) : (
          <>
            <button
              type="button"
              className="link-preview"
              title={href}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                dismissLink(editor);
                openHref(href);
              }}
            >
              {href.replace(/^https?:\/\//, '').replace(/^#\/page\/.*/, t('editor.morrowPage'))}
            </button>
            <ToolButton
              label={t('editor.openLink')}
              icon={ExternalLink}
              onClick={() => {
                dismissLink(editor);
                openHref(href);
              }}
            />
            <ToolButton
              label={t('editor.copyLink')}
              icon={Copy}
              onClick={() => {
                dismissLink(editor);
                void copyText(href).then((copied) =>
                  copied
                    ? toast(t('editor.linkCopied'), { durationMs: 2000 })
                    : toast(t('editor.couldNotCopy'), { tone: 'error' }),
                );
              }}
            />
            <ToolButton label={t('editor.editLink')} icon={Pencil} onClick={() => setEditing(true)} />
            <ToolButton
              label={t('editor.removeLink')}
              icon={Link2Off}
              onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
            />
          </>
        )}
      </div>
    </BubbleMenu>
  );
}

export function TableMenu({ editor }: { editor: Editor }) {
  const reference = useCallback(() => {
    const table = findParentNode((node) => node.type.name === 'table')(editor.state.selection);
    const dom = table ? (editor.view.nodeDOM(table.pos) as HTMLElement | null) : null;
    return dom ? { getBoundingClientRect: () => dom.getBoundingClientRect() } : null;
  }, [editor]);
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      options={TABLE_OPTIONS}
      getReferencedVirtualElement={reference}
      shouldShow={showTable}
    >
      <div className="toolbar popover table-toolbar" role="toolbar" aria-label={t('slash.items.table.title')}>
        <button
          type="button"
          className="text-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().addRowAfter().run()}
        >
          {t('editor.addRow')}
        </button>
        <button
          type="button"
          className="text-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        >
          {t('editor.addColumn')}
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className="text-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().deleteRow().run()}
        >
          {t('editor.deleteRow')}
        </button>
        <button
          type="button"
          className="text-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().deleteColumn().run()}
        >
          {t('editor.deleteColumn')}
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className="text-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeaderRow().run()}
        >
          {t('editor.headerRow')}
        </button>
        <button
          type="button"
          className="text-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
        >
          {t('editor.headerColumn')}
        </button>
        <button
          type="button"
          className="text-tool is-danger"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().deleteTable().run()}
        >
          {t('editor.deleteTable')}
        </button>
      </div>
    </BubbleMenu>
  );
}

// a square of a colour, shown beside its name in a menu
const swatches = new Map<ColorName, LucideIcon>();
function colourSwatch(color: ColorName): LucideIcon {
  let icon = swatches.get(color);
  if (!icon) {
    const Swatch = () => <span className={`menu-swatch swatch-${color}`} />;
    icon = Swatch as unknown as LucideIcon;
    swatches.set(color, icon);
  }
  return icon;
}

// a short id for a block, only needs to be unique within its page
function newBlockId(): string {
  return Math.random().toString(36).slice(2, 8);
}

// copies a [[link]] to one block: a heading by its text, anything else by a ^id written after it,
// the same way obsidian links blocks, so the link works in both apps
function copyBlockLink(editor: Editor, pos: number, pageTitle: string): void {
  const block = editor.state.doc.nodeAt(pos);
  if (!block) return;
  let anchor: string;
  if (block.type.name === 'heading') anchor = block.textContent.trim();
  else {
    // a list item's id belongs to its first paragraph
    const at = block.type.name === 'paragraph' ? pos : pos + 1;
    const paragraph = editor.state.doc.nodeAt(at);
    if (paragraph?.type.name !== 'paragraph' || !paragraph.textContent.trim()) return;
    let id = typeof paragraph.attrs.blockId === 'string' ? paragraph.attrs.blockId : '';
    if (!id) {
      id = newBlockId();
      editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...paragraph.attrs, blockId: id }));
    }
    anchor = `^${id}`;
  }
  const link = `[[${pageTitle.replace(/[[\]|#^]/g, ' ').trim()}#${anchor}]]`;
  void copyText(link).then((copied) =>
    copied ? toast(t('editor.blockLinkCopied')) : toast(t('editor.couldNotCopy'), { tone: 'error' }),
  );
}

// blocks that can be linked to on their own
function linkable(editor: Editor, pos: number): boolean {
  const block = editor.state.doc.nodeAt(pos);
  if (!block || !block.textContent.trim()) return false;
  if (block.type.name === 'heading' || block.type.name === 'paragraph') return true;
  return (
    (block.type.name === 'listItem' || block.type.name === 'taskItem') &&
    block.firstChild?.type.name === 'paragraph'
  );
}

// blocks the handle menu can turn into something else: lines of text, single list items, quotes and toggles
const TURNABLE = new Set(['listItem', 'taskItem', 'blockquote', 'details']);
function turnable(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  return !!node && (node.isTextblock || TURNABLE.has(node.type.name));
}

// the first place to type inside the block at pos
function firstTextPosition(editor: Editor, pos: number): number | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return null;
  if (node.isTextblock) return pos + 1;
  let found: number | null = null;
  node.descendants((child, offset) => {
    if (found !== null) return false;
    if (child.isTextblock) found = pos + 1 + offset + 1;
    return found === null;
  });
  return found;
}

// turns one block into another the way notion does: the block is first taken out of its list or quote, so a
// single list item changes on its own and a line inside a toggle stays in the toggle
export function turnInto(editor: Editor, pos: number, target: TurnTarget): void {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  // a whole block goes into the first column as it is, whatever it was
  if (target.kind === 'columns') {
    intoColumns(editor, pos, pos + node.nodeSize, target.count);
    return;
  }
  if (turnListItem(editor, pos, target)) return;
  if (node.type.name === 'details' && target.kind === 'toggle') {
    // a toggle stays a toggle with what it folds inside it, only its title's level changes
    const summary = node.firstChild;
    if (summary?.type.name !== 'detailsSummary') return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos + 1, undefined, { ...summary.attrs, level: target.level ?? null }),
    );
    editor.commands.focus();
    return;
  }
  if (node.type.name === 'details') {
    // a toggle opens up into its title as a line followed by what was folded inside it
    const summary = firstTextPosition(editor, pos);
    if (summary === null) return;
    const folded = node.lastChild;
    const empty =
      folded?.childCount === 1 && folded.firstChild!.isTextblock && !folded.firstChild!.content.size;
    editor.chain().setTextSelection(summary).unsetDetails().run();
    // nothing was folded inside, so its empty line goes with it
    const title = editor.state.doc.nodeAt(pos);
    if (empty && title) {
      const after = pos + title.nodeSize;
      const line = editor.state.doc.nodeAt(after);
      if (line) editor.commands.deleteRange({ from: after, to: after + line.nodeSize });
    }
  }
  const at = firstTextPosition(editor, pos);
  if (at === null) return;
  const chain = editor.chain().focus().setTextSelection(at).clearNodes();
  switch (target.kind) {
    case 'paragraph':
      chain.run();
      return;
    case 'heading':
      chain.setHeading({ level: target.level }).run();
      return;
    case 'bulletList':
      chain.toggleBulletList().run();
      return;
    case 'orderedList':
      chain.toggleOrderedList().run();
      return;
    case 'letteredList':
      chain.toggleOrderedList().updateAttributes('orderedList', { type: 'a' }).run();
      return;
    case 'callout':
      chain.setCallout().run();
      return;
    case 'equation': {
      // the line's words become the equation's latex, then it opens for editing
      chain
        .command(({ tr, state }) => {
          const { $from } = tr.selection;
          const math = state.schema.nodes.blockMath;
          if (!math || !$from.parent.isTextblock) return false;
          const latex = $from.parent.textContent.trim();
          tr.replaceWith($from.before(), $from.after(), math.create({ latex }));
          return true;
        })
        .run();
      editMathNear(editor, pos);
      return;
    }
    case 'taskList':
      chain.toggleTaskList().run();
      return;
    case 'blockquote':
      chain.setBlockquote().run();
      return;
    case 'codeBlock':
      chain.setCodeBlock().run();
      return;
    case 'toggle':
      // the line becomes the toggle's title, with an empty line folded under it
      chain
        .command(({ tr, state }) => {
          const { $from } = tr.selection;
          const line = $from.parent;
          if (!line.isTextblock || line.type.name === 'codeBlock') return false;
          const { details, detailsSummary, detailsContent, paragraph } = state.schema.nodes;
          if (!details || !detailsSummary || !detailsContent || !paragraph) return false;
          const start = $from.before();
          const toggle = details.create({ open: true }, [
            detailsSummary.create(target.level ? { level: target.level } : null, line.content),
            detailsContent.create(null, paragraph.create()),
          ]);
          tr.replaceWith(start, start + line.nodeSize, toggle);
          tr.setSelection(TextSelection.create(tr.doc, start + 2 + line.content.size));
          return true;
        })
        .run();
      return;
  }
}

// blocks laid out side by side. one block goes in the first column with the rest left empty to write in,
// several are shared out in order, as evenly as they go
function intoColumns(editor: Editor, from: number, to: number, count: number): void {
  const { schema, doc } = editor.state;
  const { columns, column, paragraph } = schema.nodes;
  if (!columns || !column || !paragraph) return;
  const blocks: PmNode[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (pos >= from && pos + node.nodeSize <= to) blocks.push(node);
    return false;
  });
  const each = Math.max(1, Math.ceil(blocks.length / count));
  const filled = Array.from({ length: count }, (_, index) => {
    const part = blocks.slice(index * each, (index + 1) * each);
    return column.create(null, part.length ? part : paragraph.create());
  });
  const tr = editor.state.tr.replaceWith(from, to, columns.create(null, filled));
  const selection = TextSelection.findFrom(tr.doc.resolve(from + 1), 1);
  if (selection) tr.setSelection(selection);
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

// a background on the whole block, not only its words. an item of a list colours its list
export function setBlockBackground(editor: Editor, positions: number[], color: ColorName | null): void {
  const { tr, doc } = editor.state;
  const done = new Set<number>();
  for (const at of positions) {
    let pos = at;
    let node = doc.nodeAt(pos);
    if (node && ['listItem', 'taskItem'].includes(node.type.name)) {
      const $pos = doc.resolve(pos);
      pos = $pos.before();
      node = $pos.parent;
    }
    if (!node || done.has(pos) || !('backgroundColor' in node.attrs)) continue;
    done.add(pos);
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: color });
  }
  if (tr.docChanged) editor.view.dispatch(tr);
  clearBlockSelection(editor);
  editor.commands.focus();
}

// several blocks picked in the margin turn one by one from the last, so the ones before keep their place.
// a list stands for its items, each of them turns the way one item on its own would
function turnBlocks(editor: Editor, range: BlockRange, target: TurnTarget): void {
  if (target.kind === 'columns') {
    intoColumns(editor, range.from, range.to, target.count);
    return;
  }
  if (target.kind === 'callout') {
    // the blocks go into one callout together
    const { $from, $to } = TextSelection.between(
      editor.state.doc.resolve(range.from),
      editor.state.doc.resolve(range.to),
    );
    editor.chain().focus().setTextSelection({ from: $from.pos, to: $to.pos }).setCallout().run();
    return;
  }
  const positions: number[] = [];
  editor.state.doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (['bulletList', 'orderedList', 'taskList'].includes(node.type.name)) return true;
    positions.push(pos);
    return false;
  });
  // lines becoming a list join into one list rather than a list each
  const list = target.kind === 'bulletList' || target.kind === 'orderedList' || target.kind === 'taskList';
  for (const pos of positions.reverse()) {
    turnInto(editor, pos, target);
    if (!list) continue;
    const { state } = editor;
    const $at = state.doc.resolve(Math.min(pos, state.doc.content.size));
    const index = $at.index(0);
    const here = state.doc.maybeChild(index);
    const next = state.doc.maybeChild(index + 1);
    if (here && next && here.type === next.type && here.type.name === target.kind)
      editor.view.dispatch(state.tr.join($at.posAtIndex(index + 1, 0)));
  }
}

// what a block is now, so the menu can tick it. a list item counts as its list
function currentKind(editor: Editor, pos: number): { kind: string; level: number | null } | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return null;
  const name = node.type.name;
  if (name === 'heading') return { kind: 'heading', level: Number(node.attrs.level) || 1 };
  if (name === 'details') {
    const level = Number(node.firstChild?.attrs.level);
    return { kind: 'toggle', level: level >= 1 && level <= 6 ? level : null };
  }
  if (name === 'listItem' || name === 'taskItem') {
    const list = editor.state.doc.resolve(pos).parent;
    const lettered = list.type.name === 'orderedList' && list.attrs.type === 'a';
    return { kind: lettered ? 'letteredList' : list.type.name, level: null };
  }
  if (name === 'orderedList' && node.attrs.type === 'a') return { kind: 'letteredList', level: null };
  return { kind: name, level: null };
}

export function BlockMenu({
  editor,
  request,
  pageTitle,
  onClose,
}: {
  editor: Editor;
  request: BlockMenuRequest;
  pageTitle: string;
  onClose: () => void;
}) {
  const picked = request.range ?? selectedBlocks(editor.state);
  const range = picked && request.pos >= picked.from && request.pos < picked.to ? picked : null;
  const turn = (target: TurnTarget) => () =>
    range ? turnBlocks(editor, range, target) : turnInto(editor, request.pos, target);
  const current = range ? null : currentKind(editor, request.pos);
  const is = (kind: string, level: number | null = null) =>
    current !== null && current.kind === kind && current.level === level;
  const block = editor.state.doc.nodeAt(request.pos);
  // pictures, dividers and other blocks without words have no colour to change
  const colourable = range !== null || (block !== null && block.textContent.trim() !== '');
  const blockPositions = () => {
    if (!range) return [request.pos];
    const positions: number[] = [];
    editor.state.doc.nodesBetween(range.from, range.to, (_node, pos) => {
      positions.push(pos);
      return false;
    });
    return positions;
  };
  const background = range
    ? null
    : (() => {
        const node = editor.state.doc.nodeAt(request.pos);
        const owner =
          node && ['listItem', 'taskItem'].includes(node.type.name)
            ? editor.state.doc.resolve(request.pos).parent
            : node;
        return (owner?.attrs.backgroundColor as ColorName | null | undefined) ?? null;
      })();
  const entries: MenuEntry[] = [
    { heading: t('editor.turnInto') },
    {
      label: t('slash.items.text.title'),
      icon: Pilcrow,
      checked: is('paragraph'),
      onSelect: turn({ kind: 'paragraph' }),
    },
    ...([Heading1, Heading2, Heading3, Heading4, Heading5, Heading6] as const).map((icon, index) => {
      const level = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6;
      return {
        label: t(`slash.items.h${level}.title`),
        icon,
        checked: is('heading', level),
        onSelect: turn({ kind: 'heading', level }),
      };
    }),
    {
      label: t('slash.items.bullet.title'),
      icon: List,
      checked: is('bulletList'),
      onSelect: turn({ kind: 'bulletList' }),
    },
    {
      label: t('slash.items.ordered.title'),
      icon: ListOrdered,
      checked: is('orderedList'),
      onSelect: turn({ kind: 'orderedList' }),
    },
    {
      label: t('slash.items.lettered.title'),
      icon: ListOrdered,
      checked: is('letteredList'),
      onSelect: turn({ kind: 'letteredList' }),
    },
    {
      label: t('slash.items.task.title'),
      icon: ListChecks,
      checked: is('taskList'),
      onSelect: turn({ kind: 'taskList' }),
    },
    {
      label: t('slash.items.toggle.title'),
      icon: ChevronRight,
      checked: is('toggle'),
      onSelect: turn({ kind: 'toggle' }),
    },
    {
      label: t('editor.toggleHeadings'),
      icon: ChevronRight,
      checked: current?.kind === 'toggle' && current.level !== null,
      submenu: ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
        label: t(`slash.items.toggleH${level}.title`),
        icon: ChevronRight,
        checked: is('toggle', level),
        onSelect: turn({ kind: 'toggle', level }),
      })),
    },
    {
      label: t('slash.items.quote.title'),
      icon: Quote,
      checked: is('blockquote'),
      onSelect: turn({ kind: 'blockquote' }),
    },
    {
      label: t('editor.callout'),
      icon: Info,
      checked: is('callout'),
      onSelect: turn({ kind: 'callout' }),
    },
    {
      label: t('slash.items.code.title'),
      icon: Code2,
      checked: is('codeBlock'),
      onSelect: turn({ kind: 'codeBlock' }),
    },
    {
      label: t('slash.items.math.title'),
      icon: Sigma,
      checked: is('blockMath'),
      onSelect: turn({ kind: 'equation' }),
    },
    {
      label: t('editor.columns'),
      icon: Columns3,
      submenu: ([2, 3, 4, 5] as const).map((count) => ({
        label: t(`slash.items.columns${count}.title`),
        icon: Columns3,
        onSelect: turn({ kind: 'columns', count }),
      })),
    },
    { separator: true },
    ...(colourable
      ? [
          {
            label: t('editor.colour'),
            icon: Palette,
            // the whole block takes the colour as its background, the words keep theirs
            submenu: [
              {
                label: t('editor.defaultBackground'),
                checked: !range && background === null,
                onSelect: () => setBlockBackground(editor, blockPositions(), null),
              },
              ...COLORS.map((color) => ({
                label: t('editor.colourBackground', { colour: colorLabel(color) }),
                icon: colourSwatch(color),
                checked: background === color,
                onSelect: () => setBlockBackground(editor, blockPositions(), color),
              })),
            ],
          },
          { separator: true as const },
        ]
      : []),
    {
      label: t('editor.moveUp'),
      icon: ArrowUp,
      shortcut: formatShortcut('Alt+Shift+↑'),
      onSelect: () => moveBlock(editor.state, editor.view.dispatch, -1),
    },
    {
      label: t('editor.moveDown'),
      icon: ArrowDown,
      shortcut: formatShortcut('Alt+Shift+↓'),
      onSelect: () => moveBlock(editor.state, editor.view.dispatch, 1),
    },
    ...(linkable(editor, request.pos)
      ? [
          {
            label: t('editor.copyLinkToBlock'),
            icon: Link2,
            onSelect: () => copyBlockLink(editor, request.pos, pageTitle),
          },
        ]
      : []),
    {
      label: t('editor.duplicate'),
      icon: Copy,
      onSelect: () => {
        if (range) {
          const blocks = editor.state.doc.slice(range.from, range.to).content;
          editor.view.dispatch(editor.state.tr.insert(range.to, blocks));
          clearBlockSelection(editor);
          return;
        }
        const node = editor.state.doc.nodeAt(request.pos);
        if (node)
          editor
            .chain()
            .focus()
            .insertContentAt(request.pos + node.nodeSize, node.toJSON())
            .run();
      },
    },
    {
      label: t('editor.delete'),
      icon: Trash2,
      danger: true,
      onSelect: () => {
        if (range) {
          editor.chain().focus().deleteRange(range).run();
          return;
        }
        const node = editor.state.doc.nodeAt(request.pos);
        if (node)
          editor
            .chain()
            .focus()
            .deleteRange({ from: request.pos, to: request.pos + node.nodeSize })
            .run();
      },
    },
  ];
  const blockType = editor.state.doc.nodeAt(request.pos)?.type.name;
  const fileId = editor.state.doc.nodeAt(request.pos)?.attrs.fileId as string | null | undefined;
  const vault = desktop?.vault;
  if (blockType === 'image' && fileId) {
    entries.unshift(
      { heading: t('slash.items.image.title') },
      { label: t('editor.copyImage'), icon: ImageIcon, onSelect: () => void copyImageFile(fileId) },
      { label: t('editor.saveACopy'), icon: Download, onSelect: () => void downloadFile(fileId) },
      ...(vault
        ? [
            {
              label: t('editor.openInDefaultApp'),
              icon: ExternalLink,
              onSelect: () => void vault.openFile(fileId),
            },
            {
              label: t('pageMenu.showInFolder'),
              icon: FolderOpen,
              onSelect: () => void vault.reveal(fileId),
            },
          ]
        : []),
      { separator: true },
    );
  }
  if (blockType === 'callout') {
    const tone = (value: string, label: string): MenuEntry => ({
      label,
      icon: Info,
      checked: editor.state.doc.nodeAt(request.pos)?.attrs.tone === value,
      onSelect: () => {
        // the obsidian type follows the colour, so the icon and the file agree with what is shown
        editor
          .chain()
          .focus()
          .setNodeSelection(request.pos)
          .updateAttributes('callout', { tone: value, kind: value })
          .run();
      },
    });
    const callout = editor.state.doc.nodeAt(request.pos);
    const setIcon = (icon: string | null) =>
      editor.chain().focus().setNodeSelection(request.pos).updateAttributes('callout', { icon }).run();
    const hidden = callout?.attrs.icon === 'none';
    entries.unshift(
      { heading: t('editor.callout') },
      tone('note', t('editor.note')),
      tone('tip', t('editor.tip')),
      tone('warning', t('editor.warning')),
      tone('danger', t('editor.danger')),
      { separator: true },
      {
        label: t('editor.changeIcon'),
        icon: Smile,
        onSelect: () =>
          openDialog({
            kind: 'emoji',
            title: t('editor.calloutIcon'),
            current: hidden ? null : ((callout?.attrs.icon as string | null) ?? null),
            onPick: (icon) => setIcon(icon ?? 'none'),
          }),
      },
      hidden
        ? { label: t('editor.showIcon'), icon: Eye, onSelect: () => setIcon(null) }
        : { label: t('editor.removeIcon'), icon: EyeOff, onSelect: () => setIcon('none') },
      ...(callout?.attrs.title
        ? []
        : [
            {
              label: t('editor.addATitle'),
              icon: Type,
              onSelect: () => {
                editor.chain().setNodeSelection(request.pos).updateAttributes('callout', { title: '' }).run();
                // the menu hands focus back to the editor as it closes, the new title row takes it after
                setTimeout(() => {
                  const dom = editor.view.nodeDOM(request.pos);
                  if (dom instanceof HTMLElement)
                    dom.querySelector<HTMLInputElement>('.callout-title')?.focus();
                }, 50);
              },
            },
          ]),
      {
        separator: true,
      },
    );
  }
  const textual = turnable(editor, request.pos);
  const firstTurnInto = entries.findIndex(
    (entry) => 'heading' in entry && entry.heading === t('editor.turnInto'),
  );
  const afterTurnInto = entries.findIndex((entry, index) => index > firstTurnInto && 'separator' in entry);
  const shown = textual
    ? entries
    : entries.filter((_entry, index) => index < firstTurnInto || index > afterTurnInto);
  return (
    <Menu
      anchor={request.rect}
      entries={shown}
      onClose={onClose}
      placement="left-start"
      label={t('editor.blockOptions')}
    />
  );
}

import type { Editor } from '@tiptap/core';
import { findParentNode } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { BubbleMenuProps } from '@tiptap/react/menus';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronRight,
  Code,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
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
  Strikethrough,
  Trash2,
  Type,
  Underline,
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
import { openPage } from '../router';
import { moveBlock } from './BlockHandle';
import type { BlockMenuRequest } from './BlockHandle';
import { toast } from '../ui';
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
  onClick: () => void;
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

export function normalizeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^(https?:|mailto:|#\/page\/)/i.test(value)) return value;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(value)) return `mailto:${value}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return `https://${value}`;
}

export function openHref(href: string): void {
  const pageId = pageIdFromHref(href);
  if (pageId) openPage(pageId);
  else openExternal(href);
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

// bubble menu props must keep their identity, new objects make tiptap dispatch and rerender in a loop
const showFormatting: BubbleMenuProps['shouldShow'] = ({ editor, state, from, to }) => {
  if (!editor.isEditable || from === to || state.selection instanceof NodeSelection) return false;
  return !editor.isActive('codeBlock');
};
const showLink: BubbleMenuProps['shouldShow'] = ({ editor, from, to }) =>
  from === to && editor.isActive('link');
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
      h1: current.isActive('heading', { level: 1 }),
      h2: current.isActive('heading', { level: 2 }),
      h3: current.isActive('heading', { level: 3 }),
      h4: current.isActive('heading', { level: 4 }),
      h5: current.isActive('heading', { level: 5 }),
      h6: current.isActive('heading', { level: 6 }),
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
        onClick={() =>
          kind === 'text'
            ? editor.chain().focus().setTextColor(null).run()
            : editor.chain().focus().setHighlightColor(null).run()
        }
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
          onClick={() =>
            kind === 'text'
              ? editor.chain().focus().setTextColor(color).run()
              : editor.chain().focus().setHighlightColor(color).run()
          }
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

export function FormattingMenu({ editor }: { editor: Editor }) {
  const [editingLink, setEditingLink] = useState(false);
  const [coloring, setColoring] = useState(false);
  const marks = useMarks(editor);
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
        },
      }) as const,
  );

  useEffect(() => {
    // capture the node now, the editor can be destroyed before this cleanup runs
    const dom = editor.view.dom;
    const open = () => setEditingLink(true);
    dom.addEventListener('morrow:edit-link', open);
    return () => dom.removeEventListener('morrow:edit-link', open);
  }, [editor]);

  return (
    <BubbleMenu editor={editor} pluginKey="formattingMenu" options={options} shouldShow={showFormatting}>
      <div className="toolbar popover" role="toolbar" aria-label={t('editor.formattingAria')}>
        {editingLink ? (
          <LinkInput editor={editor} onDone={() => setEditingLink(false)} />
        ) : coloring ? (
          <ColorPanel editor={editor} onDone={() => setColoring(false)} />
        ) : (
          <>
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
              label={t('editor.code')}
              icon={Code}
              shortcut="Mod+E"
              active={marks.code}
              onClick={() => editor.chain().focus().toggleCode().run()}
            />
            <ToolButton
              label={t('editor.highlight')}
              icon={Highlighter}
              shortcut="Mod+Shift+H"
              active={marks.highlight}
              onClick={() => editor.chain().focus().toggleHighlight().run()}
            />
            <ToolButton label={t('editor.colour')} icon={Palette} onClick={() => setColoring(true)} />
            <span className="toolbar-divider" />
            <ToolButton
              label={t('editor.link')}
              icon={Link2}
              shortcut="Mod+K"
              active={marks.link}
              onClick={() => setEditingLink(true)}
            />
            <span className="toolbar-divider" />
            <ToolButton
              label={t('slash.items.h1.title')}
              icon={Heading1}
              active={marks.h1}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            />
            <ToolButton
              label={t('slash.items.h2.title')}
              icon={Heading2}
              active={marks.h2}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            />
            <ToolButton
              label={t('slash.items.h3.title')}
              icon={Heading3}
              active={marks.h3}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            />
            <ToolButton
              label={t('slash.items.h4.title')}
              icon={Heading4}
              active={marks.h4}
              onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
            />
            <ToolButton
              label={t('slash.items.h5.title')}
              icon={Heading5}
              active={marks.h5}
              onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
            />
            <ToolButton
              label={t('slash.items.h6.title')}
              icon={Heading6}
              active={marks.h6}
              onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
            />
          </>
        )}
      </div>
    </BubbleMenu>
  );
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
          <LinkInput editor={editor} onDone={() => setEditing(false)} />
        ) : (
          <>
            <button
              type="button"
              className="link-preview"
              title={href}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => openHref(href)}
            >
              {href.replace(/^https?:\/\//, '').replace(/^#\/page\/.*/, t('editor.morrowPage'))}
            </button>
            <ToolButton label={t('editor.openLink')} icon={ExternalLink} onClick={() => openHref(href)} />
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

type TurnTarget =
  | { kind: 'paragraph' }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock' | 'toggle' };

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
function turnInto(editor: Editor, pos: number, target: TurnTarget): void {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
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
            detailsSummary.create(null, line.content),
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
  const turn = (target: TurnTarget) => () => turnInto(editor, request.pos, target);
  const entries: MenuEntry[] = [
    { heading: t('editor.turnInto') },
    { label: t('slash.items.text.title'), icon: Pilcrow, onSelect: turn({ kind: 'paragraph' }) },
    ...([Heading1, Heading2, Heading3, Heading4, Heading5, Heading6] as const).map((icon, index) => {
      const level = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6;
      return {
        label: t(`slash.items.h${level}.title`),
        icon,
        onSelect: turn({ kind: 'heading', level }),
      };
    }),
    { label: t('slash.items.bullet.title'), icon: List, onSelect: turn({ kind: 'bulletList' }) },
    { label: t('slash.items.ordered.title'), icon: ListOrdered, onSelect: turn({ kind: 'orderedList' }) },
    { label: t('slash.items.task.title'), icon: ListChecks, onSelect: turn({ kind: 'taskList' }) },
    { label: t('slash.items.toggle.title'), icon: ChevronRight, onSelect: turn({ kind: 'toggle' }) },
    { label: t('slash.items.quote.title'), icon: Quote, onSelect: turn({ kind: 'blockquote' }) },
    { label: t('slash.items.code.title'), icon: Code2, onSelect: turn({ kind: 'codeBlock' }) },
    { separator: true },
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
    entries.unshift(
      { heading: t('editor.callout') },
      tone('note', t('editor.note')),
      tone('tip', t('editor.tip')),
      tone('warning', t('editor.warning')),
      tone('danger', t('editor.danger')),
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

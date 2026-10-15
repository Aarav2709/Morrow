import type { Editor } from '@tiptap/core';
import { findParentNode } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { BubbleMenuProps } from '@tiptap/react/menus';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Code,
  Code2,
  Copy,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Info,
  Italic,
  Link2,
  Link2Off,
  List,
  ListChecks,
  ListOrdered,
  Pencil,
  Pilcrow,
  Quote,
  Strikethrough,
  Trash2,
  Underline,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pageIdFromHref } from '../../core/links';
import { formatShortcut } from '../actions';
import { Menu } from '../components/Menu';
import type { MenuEntry } from '../components/Menu';
import { openExternal } from '../platform/desktop';
import { openPage } from '../router';
import { moveBlock } from './BlockHandle';
import type { BlockMenuRequest } from './BlockHandle';

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
        placeholder="Paste or type a link"
        aria-label="Link address"
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
        Apply
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
      href: String(current.getAttributes('link').href ?? ''),
    }),
  });
}

export function FormattingMenu({ editor }: { editor: Editor }) {
  const [editingLink, setEditingLink] = useState(false);
  const marks = useMarks(editor);
  const [options] = useState(
    () =>
      ({
        placement: 'top',
        offset: 8,
        flip: true,
        shift: { padding: 8 },
        onHide: () => setEditingLink(false),
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
      <div className="toolbar popover" role="toolbar" aria-label="Formatting">
        {editingLink ? (
          <LinkInput editor={editor} onDone={() => setEditingLink(false)} />
        ) : (
          <>
            <ToolButton
              label="Bold"
              icon={Bold}
              shortcut="Mod+B"
              active={marks.bold}
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
            <ToolButton
              label="Italic"
              icon={Italic}
              shortcut="Mod+I"
              active={marks.italic}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
            <ToolButton
              label="Underline"
              icon={Underline}
              shortcut="Mod+U"
              active={marks.underline}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            />
            <ToolButton
              label="Strikethrough"
              icon={Strikethrough}
              shortcut="Mod+Shift+S"
              active={marks.strike}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            />
            <ToolButton
              label="Inline code"
              icon={Code}
              shortcut="Mod+E"
              active={marks.code}
              onClick={() => editor.chain().focus().toggleCode().run()}
            />
            <ToolButton
              label="Highlight"
              icon={Highlighter}
              shortcut="Mod+Shift+H"
              active={marks.highlight}
              onClick={() => editor.chain().focus().toggleHighlight().run()}
            />
            <span className="toolbar-divider" />
            <ToolButton
              label="Link"
              icon={Link2}
              shortcut="Mod+K"
              active={marks.link}
              onClick={() => setEditingLink(true)}
            />
            <span className="toolbar-divider" />
            <ToolButton
              label="Heading 1"
              icon={Heading1}
              active={marks.h1}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            />
            <ToolButton
              label="Heading 2"
              icon={Heading2}
              active={marks.h2}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            />
            <ToolButton
              label="Heading 3"
              icon={Heading3}
              active={marks.h3}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
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
              {href.replace(/^https?:\/\//, '').replace(/^#\/page\/.*/, 'Morrow page')}
            </button>
            <ToolButton label="Open link" icon={ExternalLink} onClick={() => openHref(href)} />
            <ToolButton label="Edit link" icon={Pencil} onClick={() => setEditing(true)} />
            <ToolButton
              label="Remove link"
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
      <div className="toolbar popover table-toolbar" role="toolbar" aria-label="Table">
        <button
          type="button"
          className="text-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().addRowAfter().run()}
        >
          + Row
        </button>
        <button
          type="button"
          className="text-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        >
          + Column
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className="text-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().deleteRow().run()}
        >
          Delete row
        </button>
        <button
          type="button"
          className="text-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().deleteColumn().run()}
        >
          Delete column
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className="text-tool"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeaderRow().run()}
        >
          Header row
        </button>
        <button
          type="button"
          className="text-tool is-danger"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().deleteTable().run()}
        >
          Delete table
        </button>
      </div>
    </BubbleMenu>
  );
}

export function BlockMenu({
  editor,
  request,
  onClose,
}: {
  editor: Editor;
  request: BlockMenuRequest;
  onClose: () => void;
}) {
  const turn = (apply: () => void) => () => {
    editor
      .chain()
      .focus()
      .setTextSelection(request.pos + 1)
      .run();
    apply();
  };
  const c = () => editor.chain().focus();
  const entries: MenuEntry[] = [
    { heading: 'Turn into' },
    { label: 'Text', icon: Pilcrow, onSelect: turn(() => c().clearNodes().run()) },
    {
      label: 'Heading 1',
      icon: Heading1,
      onSelect: turn(() => c().clearNodes().setHeading({ level: 1 }).run()),
    },
    {
      label: 'Heading 2',
      icon: Heading2,
      onSelect: turn(() => c().clearNodes().setHeading({ level: 2 }).run()),
    },
    {
      label: 'Heading 3',
      icon: Heading3,
      onSelect: turn(() => c().clearNodes().setHeading({ level: 3 }).run()),
    },
    { label: 'Bulleted list', icon: List, onSelect: turn(() => c().clearNodes().toggleBulletList().run()) },
    {
      label: 'Numbered list',
      icon: ListOrdered,
      onSelect: turn(() => c().clearNodes().toggleOrderedList().run()),
    },
    { label: 'Checklist', icon: ListChecks, onSelect: turn(() => c().clearNodes().toggleTaskList().run()) },
    { label: 'Quote', icon: Quote, onSelect: turn(() => c().clearNodes().setBlockquote().run()) },
    { label: 'Code block', icon: Code2, onSelect: turn(() => c().clearNodes().setCodeBlock().run()) },
    { separator: true },
    {
      label: 'Move up',
      icon: ArrowUp,
      shortcut: formatShortcut('Alt+Shift+↑'),
      onSelect: () => moveBlock(editor.state, editor.view.dispatch, -1),
    },
    {
      label: 'Move down',
      icon: ArrowDown,
      shortcut: formatShortcut('Alt+Shift+↓'),
      onSelect: () => moveBlock(editor.state, editor.view.dispatch, 1),
    },
    {
      label: 'Duplicate',
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
      label: 'Delete',
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
  if (blockType === 'callout') {
    const tone = (value: string, label: string): MenuEntry => ({
      label,
      icon: Info,
      checked: editor.state.doc.nodeAt(request.pos)?.attrs.tone === value,
      onSelect: () => {
        editor
          .chain()
          .focus()
          .setNodeSelection(request.pos)
          .updateAttributes('callout', { tone: value })
          .run();
      },
    });
    entries.unshift(
      { heading: 'Callout' },
      tone('note', 'Note'),
      tone('tip', 'Tip'),
      tone('warning', 'Warning'),
      {
        separator: true,
      },
    );
  }
  const textual = editor.state.doc.nodeAt(request.pos)?.isTextblock ?? false;
  const firstTurnInto = entries.findIndex((entry) => 'heading' in entry && entry.heading === 'Turn into');
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
      label="Block options"
    />
  );
}

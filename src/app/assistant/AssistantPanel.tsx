import katex from 'katex';
import {
  ArrowUp,
  Check,
  CircleAlert,
  FileText,
  Loader2,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffLines } from '../../core/diff';
import type { DiffLine } from '../../core/diff';
import { markdownToDoc } from '../../core/markdown/parse';
import { displayTitle } from '../../core/model';
import { resolveLinkTarget } from '../../core/search';
import { docToHtml } from '../../core/site';
import { formatShortcut } from '../actions';
import { openHref } from '../editor/EditorMenus';
import { desktop } from '../platform/desktop';
import type { AssistantSettings } from '../platform/desktop';
import { setPreferences } from '../platform/preferences';
import { openDialog } from '../ui';
import { getState } from '../workspace';
import { SETTINGS_CHANGED } from './AssistantSettings';
import { answerProposal, newChat, sendMessage, stopTurn, undoChange, useChat } from './chat';
import type { ChatItem } from './chat';
import { t } from '../i18n';

// the assistant's markdown as html, with [[links]] to pages you can click
function renderMarkdown(markdown: string): string {
  const state = getState();
  const doc = markdownToDoc(markdown, {
    resolvePage: (target) => resolveLinkTarget(state, target),
    resolveFile: () => null,
  });
  return docToHtml(doc, {
    href: (id) => (state.pages[id] ? `#/page/${id}` : null),
    assetPath: () => '',
    titleOf: (id) => (state.pages[id] ? displayTitle(state.pages[id]) : null),
    renderMath: (latex, display) =>
      katex.renderToString(latex, { throwOnError: false, displayMode: display }),
  });
}

function Reply({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className="assistant-reply prose-lite"
      // links go through morrow, pages open in place and web addresses in your browser
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest('a');
        if (!link) return;
        event.preventDefault();
        const href = link.getAttribute('href');
        if (href) openHref(href);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// only the changed lines and a little around them, a whole page would not fit the panel
function compact(lines: DiffLine[], context = 2): Array<DiffLine | { kind: 'gap' }> {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (let near = index - context; near <= index + context; near++) keep.add(near);
  });
  const out: Array<DiffLine | { kind: 'gap' }> = [];
  lines.forEach((line, index) => {
    if (keep.has(index)) out.push(line);
    else if (out.length === 0 || out[out.length - 1]!.kind !== 'gap') out.push({ kind: 'gap' });
  });
  return out.length > 0 && out[0]!.kind === 'gap' && out.length === 1 ? [] : out;
}

function Diff({ before, after }: { before: string; after: string }) {
  // a new page has no lines before it, not one empty line taken away
  const lines = useMemo(
    () =>
      compact(
        before ? diffLines(before, after) : diffLines('', after).filter((line) => line.kind !== 'removed'),
      ),
    [before, after],
  );
  // nothing to show, such as a new page with no text yet, an empty box would only be a stray line
  if (lines.length === 0) return null;
  return (
    <div className="diff assistant-diff" aria-label={t('assistant.proposedChange')}>
      {lines.map((line, index) =>
        line.kind === 'gap' ? (
          <div key={index} className="diff-gap">
            ⋯
          </div>
        ) : (
          <div key={index} className={`diff-line${line.kind === 'same' ? '' : ` diff-${line.kind}`}`}>
            <span className="diff-sign" aria-hidden="true">
              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
            </span>
            {line.text || ' '}
          </div>
        ),
      )}
    </div>
  );
}

function ToolLine({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const Icon = item.name === 'search_pages' ? Search : FileText;
  if (!item.proposal)
    return (
      <div className={`assistant-tool is-${item.status}`}>
        {item.status === 'failed' ? <CircleAlert size={13} /> : <Icon size={13} />}
        <span>{item.label}</span>
      </div>
    );
  const { proposal } = item;
  return (
    <div className={`assistant-change is-${item.status}`}>
      <div className="assistant-change-title">
        <Sparkles size={14} /> {proposal.title}
      </div>
      <Diff before={proposal.before} after={proposal.after} />
      <div className="assistant-change-actions">
        {item.status === 'waiting' && (
          <>
            <button
              type="button"
              className="button small primary"
              onClick={() => answerProposal(item.id, true)}
            >
              <Check size={14} /> {t('editor.apply')}
            </button>
            <button type="button" className="button small" onClick={() => answerProposal(item.id, false)}>
              {t('assistant.decline')}
            </button>
          </>
        )}
        {item.status === 'running' && (
          <span className="muted small">
            <Loader2 size={13} className="spin" /> {t('assistant.applying')}
          </span>
        )}
        {item.status === 'done' && item.applied && (
          <>
            <span className="muted small">
              <Check size={13} /> {t('assistant.done')}
            </span>
            <button type="button" className="button small" onClick={() => undoChange(item.id)}>
              <Undo2 size={14} /> {t('toasts.undo')}
            </button>
          </>
        )}
        {item.status === 'declined' && <span className="muted small">{t('assistant.declined')}</span>}
        {item.status === 'undone' && <span className="muted small">{t('assistant.undone')}</span>}
        {item.status === 'failed' && <span className="small is-error">{t('assistant.applyFailed')}</span>}
      </div>
    </div>
  );
}

export function AssistantPanel() {
  const chat = useChat();
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const load = () => void desktop?.assistant?.settings().then(setSettings);
    load();
    window.addEventListener(SETTINGS_CHANGED, load);
    return () => window.removeEventListener(SETTINGS_CHANGED, load);
  }, []);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [chat.items.length, chat.busy]);

  const ready = Boolean(settings && settings.model && (settings.hasKey || !providerNeedsKey(settings)));
  // the box can only take focus once it is enabled, after the settings arrive
  useEffect(() => {
    if (ready) input.current?.focus();
  }, [ready]);
  const label = settings?.providers.find((item) => item.id === settings.provider)?.label ?? '';

  const submit = () => {
    if (!text.trim() || chat.busy || !ready) return;
    void sendMessage(text);
    setText('');
  };

  return (
    <aside className="assistant-panel" aria-label={t('settings.sections.assistant')}>
      <header className="assistant-header">
        <strong>{t('settings.sections.assistant')}</strong>
        {settings?.model && (
          <span className="assistant-model" title={`${label}, ${settings.model}`}>
            {settings.model}
          </span>
        )}
        <span className="assistant-header-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={t('assistant.newChat')}
            title={t('assistant.newChat')}
            onClick={newChat}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t('assistant.assistantSettings')}
            title={t('assistant.assistantSettings')}
            onClick={() => openDialog({ kind: 'settings', section: 'assistant' })}
          >
            <Settings size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t('assistant.close')}
            title={t('assistant.closeWithShortcut', { shortcut: formatShortcut('Mod+J') })}
            onClick={() => setPreferences({ assistantOpen: false })}
          >
            <X size={16} />
          </button>
        </span>
      </header>
      <div className="assistant-messages" ref={list} aria-live="polite">
        {!ready && settings && (
          <div className="assistant-empty">
            <p>{t('assistant.needsSetup')}</p>
            <button
              type="button"
              className="button small"
              onClick={() => openDialog({ kind: 'settings', section: 'assistant' })}
            >
              {t('assistant.openSettings')}
            </button>
          </div>
        )}
        {ready && chat.items.length === 0 && (
          <div className="assistant-empty">
            <p>{t('assistant.introAsk')}</p>
            <p className="muted small">{t('assistant.introSafety')}</p>
          </div>
        )}
        {chat.items.map((item) => {
          if (item.kind === 'user')
            return (
              <div key={item.id} className="assistant-user">
                {item.text}
              </div>
            );
          if (item.kind === 'assistant') return <Reply key={item.id} text={item.text} />;
          if (item.kind === 'note')
            return (
              <div key={item.id} className={`assistant-note is-${item.tone}`}>
                {item.text}
              </div>
            );
          return <ToolLine key={item.id} item={item} />;
        })}
        {chat.busy && !chat.items.some((item) => item.kind === 'tool' && item.status === 'waiting') && (
          <div className="assistant-thinking">
            <Loader2 size={14} className="spin" /> {t('assistant.working')}
          </div>
        )}
      </div>
      <form
        className="assistant-input"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={input}
          rows={2}
          value={text}
          disabled={!ready}
          placeholder={ready ? t('assistant.askPlaceholder') : t('assistant.setupPlaceholder')}
          aria-label={t('assistant.messageAria')}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {chat.busy ? (
          <button
            type="button"
            className="icon-button assistant-send"
            aria-label={t('assistant.stop')}
            title={t('assistant.stop')}
            onClick={stopTurn}
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            type="submit"
            className="icon-button assistant-send"
            aria-label={t('assistant.send')}
            title={t('assistant.sendHint')}
            disabled={!text.trim() || !ready}
          >
            <ArrowUp size={16} />
          </button>
        )}
      </form>
    </aside>
  );
}

const providerNeedsKey = (settings: AssistantSettings) =>
  settings.providers.find((item) => item.id === settings.provider)?.needsKey ?? true;

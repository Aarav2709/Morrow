import katex from 'katex';
import {
  ArrowUp,
  AtSign,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Download,
  FolderOpen,
  Layers,
  Loader2,
  Paperclip,
  Plus,
  Settings,
  ShieldAlert,
  Square,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffLines } from '../../core/diff';
import type { DiffLine } from '../../core/diff';
import { markdownToDoc } from '../../core/markdown/parse';
import { displayTitle } from '../../core/model';
import type { PageId } from '../../core/model';
import { resolveLinkTarget } from '../../core/search';
import { docToHtml } from '../../core/site';
import { openHref } from '../editor/EditorMenus';
import { t } from '../i18n';
import { desktop } from '../platform/desktop';
import { usePreferences } from '../platform/preferences';
import { toast } from '../ui';
import { getState, useWorkspace } from '../workspace';
import { searchMentionCandidates } from './acpContext';
import type { AcpAttachment, MentionCandidate } from './acpContext';
import {
  activeNoteTitle,
  cancelAcpTurn,
  clearOrResetSession,
  createAcpSession,
  exportAcpSession,
  respondAcpPermission,
  sendAcpPrompt,
  setAcpMode,
  setAcpModel,
  setActiveFloatingSession,
  setActivePanelSession,
  switchSessionAgent,
  switchSessionDirectory,
  useAcpStore,
} from './acpStore';
import type { AcpChatItem, AcpDiffBlock, AcpSession, SessionOrigin } from './acpStore';
import { clearSelection, useAttachedSelection } from './selection';

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

function ReplyBlock({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className="assistant-reply prose-lite"
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

function ThoughtBlock({ text, showEmojis }: { text: string; showEmojis: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="acp-thought">
      <button type="button" className="acp-collapse-toggle" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{showEmojis ? '💭 ' : ''}Thought</span>
      </button>
      {open && <div className="acp-thought-body">{text}</div>}
    </div>
  );
}

function PlanBlock({
  entries,
  showEmojis,
}: {
  entries: Array<{ content: string; status: string; priority?: string }>;
  showEmojis: boolean;
}) {
  return (
    <div className="acp-plan">
      <div className="acp-plan-head">{showEmojis ? '📋 ' : ''}Plan</div>
      <ul>
        {entries.map((entry, idx) => (
          <li key={idx} className={`is-${entry.status}`}>
            <span className="acp-plan-dot" aria-hidden="true">
              {entry.status === 'completed' ? '✓' : entry.status === 'in_progress' ? '●' : '○'}
            </span>
            <span>{entry.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AcpDiffView({
  diff,
  autoCollapse,
  threshold,
}: {
  diff: AcpDiffBlock;
  autoCollapse: boolean;
  threshold: number;
}) {
  const lines = useMemo<DiffLine[]>(
    () => diffLines(diff.oldText, diff.newText),
    [diff.oldText, diff.newText],
  );
  const tooLong = autoCollapse && lines.length > threshold;
  const [expanded, setExpanded] = useState(!tooLong);

  let oldLine = 0;
  let newLine = 0;
  const numbered = lines.map((line) => {
    if (line.kind === 'same') {
      oldLine++;
      newLine++;
      return { ...line, oldNum: oldLine, newNum: newLine };
    }
    if (line.kind === 'removed') {
      oldLine++;
      return { ...line, oldNum: oldLine, newNum: null };
    }
    newLine++;
    return { ...line, oldNum: null, newNum: newLine };
  });

  return (
    <div className="acp-diff-wrap">
      <div className="acp-diff-head">
        <span className="acp-diff-path">{diff.path}</span>
        {tooLong && (
          <button type="button" className="link-button small" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Collapse' : `Show ${lines.length} lines`}
          </button>
        )}
      </div>
      {expanded && (
        <div className="diff assistant-diff acp-diff">
          {numbered.map((line, i) => (
            <div key={i} className={`diff-line${line.kind === 'same' ? '' : ` diff-${line.kind}`}`}>
              <span className="acp-diff-num">{line.oldNum ?? ''}</span>
              <span className="acp-diff-num">{line.newNum ?? ''}</span>
              <span className="diff-sign" aria-hidden="true">
                {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
              </span>
              {line.text || ' '}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({
  item,
  showEmojis,
  autoCollapseDiffs,
  collapseThreshold,
}: {
  item: Extract<AcpChatItem, { kind: 'tool' }>;
  showEmojis: boolean;
  autoCollapseDiffs: boolean;
  collapseThreshold: number;
}) {
  const [showOutput, setShowOutput] = useState(Boolean(item.terminalId));
  const emoji = showEmojis ? (item.terminalId ? '💻 ' : '🔧 ') : '';
  const running = item.status === 'pending' || item.status === 'in_progress';
  return (
    <div className={`acp-tool is-${item.status}`}>
      <div className="acp-tool-head">
        {running ? (
          <Loader2 size={13} className="spin" />
        ) : item.status === 'failed' ? (
          <CircleAlert size={13} />
        ) : item.terminalId ? (
          <Terminal size={13} />
        ) : (
          <Wrench size={13} />
        )}
        <span className="acp-tool-title">
          {emoji}
          {item.title}
        </span>
        <span className="acp-tool-status">{item.status}</span>
        {(item.output || item.terminalOutput) && (
          <button
            type="button"
            className="icon-button small"
            aria-label="Toggle tool output"
            onClick={() => setShowOutput(!showOutput)}
          >
            {showOutput ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        )}
      </div>
      {item.diff && (
        <AcpDiffView diff={item.diff} autoCollapse={autoCollapseDiffs} threshold={collapseThreshold} />
      )}
      {showOutput && item.terminalOutput !== undefined && (
        <pre className="acp-terminal">
          <code>{item.terminalOutput || '(running...)'}</code>
          {item.exitCode !== undefined && item.exitCode !== null && (
            <div className="acp-terminal-exit">Exit code {item.exitCode}</div>
          )}
        </pre>
      )}
      {showOutput && !item.terminalOutput && item.output && (
        <pre className="acp-tool-output">
          <code>{item.output}</code>
        </pre>
      )}
    </div>
  );
}

function PermissionCard({
  sessionId,
  item,
}: {
  sessionId: string;
  item: Extract<AcpChatItem, { kind: 'permission' }>;
}) {
  return (
    <div className={`assistant-change acp-permission is-${item.status}`}>
      <div className="assistant-change-title">
        <ShieldAlert size={14} /> {item.title}
      </div>
      {item.detail && (
        <pre className="acp-permission-detail">
          <code>{item.detail.slice(0, 600)}</code>
        </pre>
      )}
      <div className="assistant-change-actions">
        {item.status === 'waiting' ? (
          item.options.map((opt) => (
            <button
              key={opt.optionId}
              type="button"
              className={`button small${opt.kind.startsWith('allow') ? ' primary' : ''}`}
              onClick={() => void respondAcpPermission(sessionId, item.requestId, opt)}
            >
              {opt.name}
            </button>
          ))
        ) : (
          <span className="muted small">
            {item.status === 'approved' ? (
              <>
                <Check size={13} /> {item.chosenOptionName || 'Allowed'}
              </>
            ) : (
              item.chosenOptionName || 'Rejected'
            )}
          </span>
        )}
      </div>
    </div>
  );
}

async function fileToAttachment(file: File): Promise<AcpAttachment | null> {
  const isImage = file.type.startsWith('image/');
  const isAudio = file.type.startsWith('audio/');
  if (!isImage && !isAudio) return null;
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);
  const previewUrl = URL.createObjectURL(file);
  return {
    id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: file.name || (isImage ? 'image.png' : 'audio.webm'),
    mimeType: file.type,
    kind: isImage ? 'image' : 'audio',
    base64,
    previewUrl,
  };
}

export function AgentClientView({
  sessionId: forcedSessionId,
  origin = 'panel',
  compact = false,
  onOpenSessionManager,
  onOpenSettings,
  onClose,
}: {
  sessionId?: string;
  origin?: SessionOrigin;
  compact?: boolean;
  onOpenSessionManager?: () => void;
  onOpenSettings?: () => void;
  onClose?: () => void;
}) {
  const store = useAcpStore();
  const prefs = usePreferences();
  const workspace = useWorkspace();
  const highlighted = useAttachedSelection();

  const resolvedId =
    forcedSessionId ?? (origin === 'floating' ? store.activeFloatingSessionId : store.activePanelSessionId);
  const session: AcpSession | null =
    store.sessions.find((s) => s.id === resolvedId) ??
    store.sessions.find((s) => s.origin === origin) ??
    null;

  useEffect(() => {
    if (!session && !forcedSessionId && desktop?.acp) {
      void createAcpSession({ origin });
    }
  }, [session, forcedSessionId, origin]);

  const [text, setText] = useState('');
  const [explicitMentions, setExplicitMentions] = useState<Array<{ id: PageId; title: string }>>([]);
  const [attachments, setAttachments] = useState<AcpAttachment[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [session?.items.length, session?.status]);

  const enabledAgents = useMemo(() => {
    const out: Array<{ id: string; label: string }> = [];
    for (const p of store.settings?.presets ?? []) {
      if (p.enabled) out.push({ id: p.id, label: p.displayName });
    }
    for (const c of store.settings?.customAgents ?? []) {
      if (c.enabled) out.push({ id: c.id, label: c.displayName || c.id });
    }
    return out;
  }, [store.settings]);

  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (mentionQuery === null) return [];
    return searchMentionCandidates(workspace, mentionQuery, highlighted, 10);
  }, [mentionQuery, workspace, highlighted]);

  const slashCandidates = useMemo(() => {
    if (slashQuery === null || !session) return [];
    const q = slashQuery.toLowerCase();
    return session.availableCommands.filter(
      (cmd) => cmd.name.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q),
    );
  }, [slashQuery, session]);

  const waitingElsewhere = store.sessions.filter(
    (s) => s.id !== session?.id && s.status === 'waiting-permission',
  ).length;

  const updateTriggers = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const mentionMatch = /(?:^|\s)@([^\s@#[\]]*)$/.exec(before);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1] ?? '');
      setSlashQuery(null);
      setSuggestIndex(0);
      return;
    }
    setMentionQuery(null);
    const slashMatch = /^\/([^\s]*)$/.exec(before);
    if (slashMatch && session && session.availableCommands.length > 0) {
      setSlashQuery(slashMatch[1] ?? '');
      setSuggestIndex(0);
      return;
    }
    setSlashQuery(null);
  };

  const insertMention = (cand: MentionCandidate) => {
    const cursor = inputRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const replaced = before.replace(
      /@([^\s@#[\]]*)$/,
      cand.kind === 'selection' ? '@selection ' : `@[[${cand.title}]] `,
    );
    setText(`${replaced}${after}`);
    if (cand.kind === 'page' && !explicitMentions.some((m) => m.id === cand.id)) {
      setExplicitMentions((prev) => [...prev, { id: cand.id, title: cand.title }]);
    }
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const insertSlashCommand = (name: string) => {
    setText(`/${name} `);
    setSlashQuery(null);
    inputRef.current?.focus();
  };

  const handleFiles = async (files: FileList | File[]) => {
    const loaded = (await Promise.all(Array.from(files).map(fileToAttachment))).filter(
      (a): a is AcpAttachment => a !== null,
    );
    if (loaded.length > 0) setAttachments((prev) => [...prev, ...loaded]);
  };

  const submit = async () => {
    if (!session) return;
    if (session.status === 'running' || session.status === 'starting') return;
    if (!text.trim() && attachments.length === 0) return;
    const msg = text;
    const pageIds = explicitMentions.map((m) => m.id);
    const atts = attachments;
    setText('');
    setExplicitMentions([]);
    setAttachments([]);
    setMentionQuery(null);
    setSlashQuery(null);
    await sendAcpPrompt(session.id, msg, { explicitPageIds: pageIds, attachments: atts });
  };

  const activeTitle = prefs.acpAutoMentionActive ? activeNoteTitle() : null;
  const cwdShort = session?.cwd ? session.cwd.split(/[\\/]/).filter(Boolean).pop() || session.cwd : 'Vault';
  const busy = session?.status === 'running' || session?.status === 'starting';

  return (
    <div
      className={`acp-view${compact ? ' is-compact' : ''}`}
      style={{ fontSize: `${prefs.acpFontSize}px` }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
      }}
    >
      <header className="assistant-header acp-header">
        <Bot size={15} />
        <select
          className="acp-header-select"
          aria-label="Select agent"
          value={session?.agentId ?? ''}
          onChange={(e) => session && void switchSessionAgent(session.id, e.target.value)}
        >
          {enabledAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>

        {session && (
          <button
            type="button"
            className="acp-cwd-pill"
            title={`Working directory: ${session.cwd || 'Vault root'} (click to change)`}
            onClick={() => {
              void desktop?.acp?.pickDirectory(session.cwd).then((dir) => {
                if (dir) void switchSessionDirectory(session.id, dir);
              });
            }}
          >
            <FolderOpen size={12} />
            <span>{cwdShort}</span>
          </button>
        )}

        <span className="assistant-header-actions">
          {onOpenSessionManager && (
            <button
              type="button"
              className="icon-button acp-sm-btn"
              title="Session Manager & Broadcast"
              aria-label="Session Manager"
              onClick={onOpenSessionManager}
            >
              <Layers size={15} />
              {waitingElsewhere > 0 && <span className="acp-badge-dot" />}
            </button>
          )}
          {session && session.items.length > 0 && (
            <button
              type="button"
              className="icon-button"
              title="Export chat to note"
              aria-label="Export chat to note"
              onClick={() =>
                void exportAcpSession(session.id, { open: prefs.acpOpenAfterExport }).then((id) => {
                  if (id) toast('Exported chat to note.');
                })
              }
            >
              <Download size={15} />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            title={t('assistant.newChat')}
            aria-label={t('assistant.newChat')}
            onClick={() => {
              if (session) void clearOrResetSession(session.id);
              else void createAcpSession({ origin });
            }}
          >
            <Plus size={16} />
          </button>
          {onOpenSettings && (
            <button
              type="button"
              className="icon-button"
              title={t('assistant.assistantSettings')}
              aria-label={t('assistant.assistantSettings')}
              onClick={onOpenSettings}
            >
              <Settings size={15} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="icon-button"
              title={t('assistant.close')}
              aria-label={t('assistant.close')}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          )}
        </span>
      </header>

      {store.sessions.filter((s) => s.origin === origin).length > 1 && !compact && (
        <div className="acp-session-strip">
          {store.sessions
            .filter((s) => s.origin === origin)
            .slice(0, 8)
            .map((s) => (
              <button
                key={s.id}
                type="button"
                className={`acp-session-tab${s.id === session?.id ? ' is-active' : ''}`}
                onClick={() =>
                  origin === 'floating' ? setActiveFloatingSession(s.id) : setActivePanelSession(s.id)
                }
              >
                {s.status === 'waiting-permission' && <span className="acp-dot-warn" />}
                {s.status === 'running' && <span className="acp-dot-run" />}
                <span>{s.title}</span>
              </button>
            ))}
        </div>
      )}

      <div className="assistant-messages" ref={listRef} aria-live="polite">
        {(!session || session.items.length === 0) && (
          <div className="assistant-empty">
            <p>
              Chat with <strong>{session?.agentName || 'ACP Agent'}</strong> directly in your vault.
            </p>
            <p className="muted small">
              Type <code>@</code> to mention notes, <code>/</code> for agent commands, or drop images.
            </p>
          </div>
        )}

        {session?.items.map((item) => {
          if (item.kind === 'user') {
            return (
              <div key={item.id} className="assistant-user">
                {item.mentions && item.mentions.length > 0 && (
                  <div className="acp-msg-mentions">
                    {item.mentions.map((m) => (
                      <span key={m} className="acp-chip-inline">
                        @{m}
                      </span>
                    ))}
                  </div>
                )}
                {item.text && <div>{item.text}</div>}
                {item.attachments && item.attachments.length > 0 && (
                  <div className="acp-msg-attachments">
                    {item.attachments.map((att) =>
                      att.kind === 'image' ? (
                        <img key={att.id} src={att.previewUrl} alt={att.name} className="acp-msg-thumb" />
                      ) : (
                        <span key={att.id} className="acp-chip-inline">
                          🎵 {att.name}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          }
          if (item.kind === 'assistant') return <ReplyBlock key={item.id} text={item.text} />;
          if (item.kind === 'thought')
            return <ThoughtBlock key={item.id} text={item.text} showEmojis={prefs.acpShowEmojis} />;
          if (item.kind === 'plan')
            return <PlanBlock key={item.id} entries={item.entries} showEmojis={prefs.acpShowEmojis} />;
          if (item.kind === 'tool')
            return (
              <ToolCallBlock
                key={item.id}
                item={item}
                showEmojis={prefs.acpShowEmojis}
                autoCollapseDiffs={prefs.acpAutoCollapseDiffs}
                collapseThreshold={prefs.acpCollapseDiffThreshold}
              />
            );
          if (item.kind === 'permission')
            return <PermissionCard key={item.id} sessionId={session.id} item={item} />;
          return (
            <div key={item.id} className={`assistant-note is-${item.tone}`}>
              {item.text}
            </div>
          );
        })}

        {busy && session?.status !== 'waiting-permission' && (
          <div className="assistant-thinking">
            <Loader2 size={14} className="spin" />{' '}
            {session?.status === 'starting' ? 'Starting agent…' : t('assistant.working')}
          </div>
        )}
      </div>

      {prefs.acpDebugMode && session && (
        <div className="acp-debug">
          <button type="button" className="acp-collapse-toggle" onClick={() => setShowDebug(!showDebug)}>
            {showDebug ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span>Debug JSON-RPC ({session.debugLog.length})</span>
          </button>
          {showDebug && (
            <pre className="acp-debug-log">
              {session.debugLog.map((d) => `[${d.direction}] ${d.line}`).join('\n') || '(no traffic yet)'}
            </pre>
          )}
        </div>
      )}

      {highlighted && (
        <div className="assistant-highlighted">
          <div className="assistant-highlighted-head">
            <span>{t('assistant.highlighted')} (@selection)</span>
            <button
              type="button"
              className="icon-button"
              aria-label={t('assistant.removeHighlighted')}
              onClick={clearSelection}
            >
              <X size={14} />
            </button>
          </div>
          <blockquote>
            {highlighted.text.length > 200 ? `${highlighted.text.slice(0, 200)}…` : highlighted.text}
          </blockquote>
        </div>
      )}

      {(activeTitle || explicitMentions.length > 0 || attachments.length > 0) && (
        <div className="acp-context-bar">
          {activeTitle && <span className="acp-chip">Active: [[{activeTitle}]]</span>}
          {explicitMentions.map((m) => (
            <span key={m.id} className="acp-chip">
              @{m.title}
              <button
                type="button"
                aria-label={`Remove ${m.title}`}
                onClick={() => setExplicitMentions((prev) => prev.filter((x) => x.id !== m.id))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          {attachments.map((att) => (
            <span key={att.id} className="acp-chip">
              {att.kind === 'image' ? '🖼' : '🎵'} {att.name}
              <button
                type="button"
                aria-label={`Remove ${att.name}`}
                onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== att.id))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="acp-composer-wrap">
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div className="acp-suggest popover" role="listbox">
            {mentionCandidates.map((cand, idx) => (
              <button
                key={cand.id}
                type="button"
                className={`acp-suggest-item${idx === suggestIndex ? ' is-active' : ''}`}
                onClick={() => insertMention(cand)}
              >
                <span className="acp-suggest-title">
                  {cand.kind === 'selection' ? '@selection' : cand.title}
                </span>
                <span className="acp-suggest-sub">{cand.pathLabel}</span>
              </button>
            ))}
          </div>
        )}

        {slashQuery !== null && slashCandidates.length > 0 && (
          <div className="acp-suggest popover" role="listbox">
            {slashCandidates.map((cmd, idx) => (
              <button
                key={cmd.name}
                type="button"
                className={`acp-suggest-item${idx === suggestIndex ? ' is-active' : ''}`}
                onClick={() => insertSlashCommand(cmd.name)}
              >
                <span className="acp-suggest-title">
                  /{cmd.name} {cmd.input?.hint ? <em className="muted">{cmd.input.hint}</em> : null}
                </span>
                <span className="acp-suggest-sub">{cmd.description}</span>
              </button>
            ))}
          </div>
        )}

        <form
          className="assistant-input acp-input"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <textarea
            ref={inputRef}
            rows={2}
            value={text}
            placeholder={`Message ${session?.agentName ?? 'agent'}… (@ note, / command)`}
            onChange={(e) => {
              setText(e.target.value);
              updateTriggers(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onPaste={(e) => {
              if (e.clipboardData.files.length > 0) void handleFiles(e.clipboardData.files);
            }}
            onKeyDown={(e) => {
              const items =
                mentionQuery !== null ? mentionCandidates : slashQuery !== null ? slashCandidates : [];
              if (items.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSuggestIndex((i) => (i + 1) % items.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSuggestIndex((i) => (i - 1 + items.length) % items.length);
                  return;
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                  e.preventDefault();
                  if (mentionQuery !== null && mentionCandidates[suggestIndex]) {
                    insertMention(mentionCandidates[suggestIndex]!);
                  } else if (slashQuery !== null && slashCandidates[suggestIndex]) {
                    insertSlashCommand(slashCandidates[suggestIndex]!.name);
                  }
                  return;
                }
                if (e.key === 'Escape') {
                  setMentionQuery(null);
                  setSlashQuery(null);
                  return;
                }
              }

              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                const sendWithEnter = prefs.acpSendShortcut === 'enter' && !e.shiftKey;
                const sendWithMod = prefs.acpSendShortcut === 'mod-enter' && (e.ctrlKey || e.metaKey);
                if (sendWithEnter || sendWithMod) {
                  e.preventDefault();
                  void submit();
                }
              }
            }}
          />
          <div className="acp-input-controls">
            <div className="acp-input-meta">
              {session && session.modes.length > 0 && (
                <select
                  className="acp-mini-select"
                  aria-label="Agent mode"
                  value={session.currentModeId ?? ''}
                  onChange={(e) => void setAcpMode(session.id, e.target.value)}
                >
                  {session.modes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
              {session && session.models.length > 0 && (
                <select
                  className="acp-mini-select"
                  aria-label="Agent model"
                  value={session.currentModelId ?? ''}
                  onChange={(e) => void setAcpModel(session.id, e.target.value)}
                >
                  {session.models.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="icon-button small"
                title="Mention note (@)"
                aria-label="Mention note"
                onClick={() => {
                  setText((prev) => `${prev}@`);
                  setMentionQuery('');
                  inputRef.current?.focus();
                }}
              >
                <AtSign size={14} />
              </button>
              <button
                type="button"
                className="icon-button small"
                title="Attach image or audio"
                aria-label="Attach image or audio"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={14} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,audio/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) void handleFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            {busy ? (
              <button
                type="button"
                className="icon-button assistant-send"
                aria-label={t('assistant.stop')}
                onClick={() => session && void cancelAcpTurn(session.id)}
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                className="icon-button assistant-send"
                aria-label={t('assistant.send')}
                disabled={!text.trim() && attachments.length === 0}
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

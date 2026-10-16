import {
  CalendarDays,
  Flame,
  FileUp,
  LayoutDashboard,
  Network,
  Plus,
  Search,
  Shuffle,
  Table2,
} from 'lucide-react';
import { useMemo } from 'react';
import { collectTasks } from '../../core/tasks';
import { activityWeeks, dayLabel, onThisDay, rediscover, streak, totalWords } from '../../core/insights';
import { docToPlainText } from '../../core/doc';
import { COVER_GRADIENTS, displayTitle } from '../../core/model';
import type { PageMeta, WorkspaceState } from '../../core/model';
import { ancestorsOf, livePages } from '../../core/tree';
import { formatShortcut } from '../actions';
import { createPage, importMarkdown, openToday } from '../operations';
import { navigate, openPage } from '../router';
import { setUi } from '../ui';
import { getSession, useWorkspace } from '../workspace';
import { useCover } from './Cover';
import { Kbd, relativeTime } from './primitives';
import { PageIcon } from './Sidebar';
import { TopBar } from './TopBar';
import { TaskList } from './Views';

// figures for the home page, worked out once for each version of the workspace
const factsCache = new WeakMap<WorkspaceState, ReturnType<typeof computeFacts>>();
function computeFacts(state: WorkspaceState) {
  const today = new Date();
  return {
    openTasks: collectTasks(state).filter((task) => !task.checked),
    words: totalWords(state),
    memories: onThisDay(state, today),
    again: rediscover(state, today),
  };
}
function factsOf(state: WorkspaceState) {
  let facts = factsCache.get(state);
  if (!facts) {
    facts = computeFacts(state);
    factsCache.set(state, facts);
  }
  return facts;
}

function greeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// pages without a cover still get one of the gradients, the same one every time
function cardGradient(page: PageMeta): string {
  let hash = 0;
  for (const char of page.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `cover-gradient-${(hash % COVER_GRADIENTS) + 1}`;
}

function PageCard({ page }: { page: PageMeta }) {
  const state = useWorkspace();
  const { className, image } = useCover(page.cover);
  const path = ancestorsOf(state.pages, page.id).reverse().map(displayTitle).join(' / ');
  return (
    <button type="button" className="home-card" onClick={() => openPage(page.id)}>
      <span
        className={`home-card-cover ${page.cover ? className : cardGradient(page)}`}
        style={image ? { backgroundImage: `url("${image}")` } : undefined}
      >
        <span className="home-card-icon">
          <PageIcon page={page} />
        </span>
      </span>
      <span className="home-card-body">
        <span className="home-card-title">{displayTitle(page)}</span>
        <span className="home-card-meta">
          {path ? `${path} · ` : ''}
          {relativeTime(Math.max(page.updatedAt, page.lastOpenedAt ?? 0))}
        </span>
      </span>
    </button>
  );
}

function Heatmap({ activity }: { activity: Record<string, number> }) {
  const weeks = activityWeeks(activity, new Date(), 26);
  const max = Math.max(1, ...weeks.flat().map((day) => day.count));
  const level = (count: number) => (count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)));
  return (
    <div className="heatmap" role="img" aria-label="Writing activity over the last six months">
      {weeks.map((week, index) => (
        <div key={index} className="heatmap-week">
          {week.map((day) => (
            <span
              key={day.key}
              className={`heatmap-day level-${day.future ? 'future' : level(day.count)}`}
              title={day.future ? '' : `${dayLabel(day.key)}: ${day.count} save${day.count === 1 ? '' : 's'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function HomeView() {
  const state = useWorkspace();
  const now = new Date();
  const live = useMemo(() => livePages(state.pages), [state.pages]);
  const recent = useMemo(
    () =>
      [...live]
        .filter((page) => page.kind !== 'journal' && page.kind !== 'templates')
        .sort(
          (a, b) => Math.max(b.lastOpenedAt ?? 0, b.updatedAt) - Math.max(a.lastOpenedAt ?? 0, a.updatedAt),
        )
        .slice(0, 6),
    [live],
  );
  const { openTasks, words, memories, again } = factsOf(state);
  // read on every render, the workspace changing rerenders this view so the chart follows writing as it happens
  const activity = getSession().activity();
  const days = streak(activity, now);

  return (
    <div className="view">
      <TopBar />
      <div className="page-scroll">
        <div className="home">
          <header className="home-header">
            <p className="home-date">
              {now.toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
            <h1 className="home-greeting">{greeting(now)}.</h1>
          </header>

          <div className="home-stats">
            <div className="home-stat tint-orange">
              <Flame size={18} />
              <strong>{days}</strong>
              <span>day streak</span>
            </div>
            <div className="home-stat tint-blue">
              <strong>{live.length.toLocaleString()}</strong>
              <span>pages</span>
            </div>
            <div className="home-stat tint-green">
              <strong>{words.toLocaleString()}</strong>
              <span>words</span>
            </div>
            <button
              type="button"
              className="home-stat tint-purple"
              onClick={() => navigate({ name: 'tasks' })}
            >
              <strong>{openTasks.length}</strong>
              <span>open tasks</span>
            </button>
          </div>

          <div className="quick-actions">
            <button type="button" className="quick-action tint-blue" onClick={() => createPage()}>
              <Plus size={16} strokeWidth={1.75} /> New page <Kbd>{formatShortcut('Alt+N')}</Kbd>
            </button>
            <button type="button" className="quick-action tint-orange" onClick={() => openToday()}>
              <CalendarDays size={16} strokeWidth={1.75} /> Today <Kbd>{formatShortcut('Alt+D')}</Kbd>
            </button>
            <button
              type="button"
              className="quick-action tint-green"
              onClick={() => createPage({ kind: 'database' })}
            >
              <Table2 size={16} strokeWidth={1.75} /> Database
            </button>
            <button
              type="button"
              className="quick-action tint-purple"
              onClick={() => createPage({ kind: 'canvas' })}
            >
              <LayoutDashboard size={16} strokeWidth={1.75} /> Canvas
            </button>
            <button
              type="button"
              className="quick-action tint-pink"
              onClick={() => navigate({ name: 'graph', focus: null })}
            >
              <Network size={16} strokeWidth={1.75} /> Graph
            </button>
            <button type="button" className="quick-action" onClick={() => setUi({ palette: true })}>
              <Search size={16} strokeWidth={1.75} /> Search <Kbd>{formatShortcut('Mod+K')}</Kbd>
            </button>
          </div>

          {live.length === 0 ? (
            <section className="home-empty">
              <h2>Your vault is empty</h2>
              <p>Start with a blank page, or bring in notes you already have.</p>
              <div className="button-row">
                <button type="button" className="button primary" onClick={() => createPage()}>
                  <Plus size={15} /> Create a page
                </button>
                <button type="button" className="button" onClick={() => void importMarkdown()}>
                  <FileUp size={15} /> Import
                </button>
              </div>
            </section>
          ) : (
            <section className="home-section" aria-labelledby="recent-heading">
              <h2 id="recent-heading" className="section-label">
                Jump back in
              </h2>
              <div className="home-cards">
                {recent.map((page) => (
                  <PageCard key={page.id} page={page} />
                ))}
              </div>
            </section>
          )}

          <section className="home-section" aria-labelledby="activity-heading">
            <h2 id="activity-heading" className="section-label">
              Your writing
            </h2>
            <Heatmap activity={activity} />
          </section>

          {(memories.length > 0 || again) && (
            <div className="home-pair">
              {memories.length > 0 && (
                <section className="home-section home-memory" aria-labelledby="memory-heading">
                  <h2 id="memory-heading" className="section-label">
                    On this day
                  </h2>
                  <ul className="link-list">
                    {memories.map((page) => (
                      <li key={page.id}>
                        <button type="button" className="link-row" onClick={() => openPage(page.id)}>
                          <span className="link-row-title">{displayTitle(page)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {again && (
                <section className="home-section home-memory" aria-labelledby="again-heading">
                  <h2 id="again-heading" className="section-label">
                    <Shuffle size={12} /> Rediscover
                  </h2>
                  <button type="button" className="rediscover" onClick={() => openPage(again.id)}>
                    <strong>{displayTitle(again)}</strong>
                    <span>{docToPlainText(state.docs[again.id] ?? { type: 'doc' }).slice(0, 180)}…</span>
                  </button>
                </section>
              )}
            </div>
          )}

          {openTasks.length > 0 && (
            <section className="home-section" aria-labelledby="tasks-heading">
              <h2 id="tasks-heading" className="section-label">
                Open tasks <span className="section-count">{openTasks.length}</span>
              </h2>
              <TaskList tasks={openTasks.slice(0, 6)} state={state} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

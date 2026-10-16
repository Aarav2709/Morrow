import { CircleCheckBig, FileText, FileUp, Flame, PenLine, Plus, Shuffle } from 'lucide-react';
import { useMemo } from 'react';
import { collectTasks } from '../../core/tasks';
import { activityWeeks, dayLabel, onThisDay, rediscover, streak, totalWords } from '../../core/insights';
import { docToPlainText } from '../../core/doc';
import { COVER_GRADIENTS, displayTitle } from '../../core/model';
import type { PageMeta, WorkspaceState } from '../../core/model';
import { ancestorsOf, livePages } from '../../core/tree';
import { createPage, importMarkdown } from '../operations';
import { usePreferences } from '../platform/preferences';
import { navigate, openPage } from '../router';
import { getSession, useWorkspace } from '../workspace';
import { useCover } from './Cover';
import { relativeTime } from './primitives';
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

const WEEKS = 53;

// a year of writing, one square a day, filling the width like github's chart
function Heatmap({ activity }: { activity: Record<string, number> }) {
  const weeks = activityWeeks(activity, new Date(), WEEKS);
  const days = weeks.flat().filter((day) => !day.future);
  const max = Math.max(1, ...days.map((day) => day.count));
  const level = (count: number) => (count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)));
  const active = days.filter((day) => day.count > 0).length;
  // a month name over the first week that starts in that month
  const months = weeks.map((week, index) => {
    const first = week[0]!.key;
    const previous = index > 0 ? weeks[index - 1]![0]!.key : null;
    return !previous || previous.slice(5, 7) !== first.slice(5, 7)
      ? new Date(`${first}T00:00`).toLocaleDateString(undefined, { month: 'short' })
      : '';
  });
  return (
    <div className="heatmap-card">
      <div className="heatmap-months" aria-hidden="true">
        {months.map((month, index) => (
          <span key={index}>{index > 0 && index < WEEKS - 2 ? month : ''}</span>
        ))}
      </div>
      <div className="heatmap" role="img" aria-label={`Writing on ${active} days in the last year`}>
        {weeks.map((week, index) => (
          <div key={index} className="heatmap-week">
            {week.map((day) => (
              <span
                key={day.key}
                className={`heatmap-day level-${day.future ? 'future' : level(day.count)}`}
                title={
                  day.future ? '' : `${dayLabel(day.key)}: ${day.count} save${day.count === 1 ? '' : 's'}`
                }
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-foot">
        <span>
          Wrote on {active.toLocaleString()} {active === 1 ? 'day' : 'days'} in the last year
        </span>
        <span className="heatmap-legend" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((value) => (
            <span key={value} className={`heatmap-day level-${value}`} />
          ))}
          More
        </span>
      </div>
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
  const prefs = usePreferences();

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
            <h1 className="home-greeting">
              {greeting(now)}
              {prefs.name ? `, ${prefs.name}` : ''}.
            </h1>
          </header>

          <div className="home-stats">
            <div className="home-stat tint-orange">
              <Flame size={18} />
              <strong>{days}</strong>
              <span>day streak</span>
            </div>
            <div className="home-stat tint-blue">
              <FileText size={18} />
              <strong>{live.length.toLocaleString()}</strong>
              <span>{live.length === 1 ? 'page' : 'pages'}</span>
            </div>
            <div className="home-stat tint-green">
              <PenLine size={18} />
              <strong>{words.toLocaleString()}</strong>
              <span>{words === 1 ? 'word' : 'words'}</span>
            </div>
            <button
              type="button"
              className="home-stat tint-purple"
              onClick={() => navigate({ name: 'tasks' })}
            >
              <CircleCheckBig size={18} />
              <strong>{openTasks.length}</strong>
              <span>open {openTasks.length === 1 ? 'task' : 'tasks'}</span>
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

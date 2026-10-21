import { CalendarDays, CircleCheckBig, FileText, FileUp, Flame, PenLine, Plus, Shuffle } from 'lucide-react';
import { useMemo } from 'react';
import { collectTasks } from '../../core/tasks';
import { activityWeeks, dayLabel, onThisDay, rediscover, streak, totalWords } from '../../core/insights';
import { docToPlainText } from '../../core/doc';
import { COVER_GRADIENTS, displayTitle } from '../../core/model';
import type { PageMeta, WorkspaceState } from '../../core/model';
import { ancestorsOf, livePages } from '../../core/tree';
import { createPage, importMarkdown, openToday } from '../operations';
import { usePreferences } from '../platform/preferences';
import { navigate, openPage } from '../router';
import { getSession, useWorkspace } from '../workspace';
import { useCover } from './Cover';
import { dateLocale, tp, useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n';
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

function greeting(date: Date, t: (key: TranslationKey) => string): string {
  const hour = date.getHours();
  if (hour < 5) return t('home.greetings.night');
  if (hour < 12) return t('home.greetings.morning');
  if (hour < 18) return t('home.greetings.afternoon');
  return t('home.greetings.evening');
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
function Heatmap({ activity, locale }: { activity: Record<string, number>; locale: string }) {
  const { t } = useTranslation();
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
      ? new Date(`${first}T00:00`).toLocaleDateString(dateLocale(), { month: 'short' })
      : '';
  });
  return (
    <div className="heatmap-card">
      <div className="heatmap-months" aria-hidden="true">
        {months.map((month, index) => (
          <span key={index}>{index > 0 && index < WEEKS - 2 ? month : ''}</span>
        ))}
      </div>
      <div className="heatmap" role="img" aria-label={t('home.writingAria', { active })}>
        {weeks.map((week, index) => (
          <div key={index} className="heatmap-week">
            {week.map((day) => (
              <span
                key={day.key}
                className={`heatmap-day level-${day.future ? 'future' : level(day.count)}`}
                title={day.future ? '' : `${dayLabel(day.key)}: ${tp('home.saveCount', day.count)}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-foot">
        <span>
          {t('home.wroteOnDays', {
            count: active.toLocaleString(locale),
            days: active === 1 ? t('home.wroteDaySingle') : t('home.wroteDayPlural'),
          })}
        </span>
        <span className="heatmap-legend" aria-hidden="true">
          {t('home.heatmapLess')}
          {[0, 1, 2, 3, 4].map((value) => (
            <span key={value} className={`heatmap-day level-${value}`} />
          ))}
          {t('home.heatmapMore')}
        </span>
      </div>
    </div>
  );
}

export function HomeView() {
  const { t, locale } = useTranslation();
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
      <TopBar>
        <span className="topbar-title">{t('home.title')}</span>
      </TopBar>
      <div className="page-scroll">
        <div className="home">
          <header className="home-header">
            <p className="home-date">
              {now.toLocaleDateString(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
            <h1 className="home-greeting">
              {greeting(now, t)}
              {prefs.name ? `, ${prefs.name}` : ''}.
            </h1>
            <button type="button" className="button primary home-today" onClick={() => openToday()}>
              <CalendarDays size={15} /> {t('home.todayNote')}
            </button>
          </header>

          <div className="home-stats">
            <div className="home-stat tint-orange">
              <Flame size={18} />
              <strong>{days}</strong>
              <span>{t('home.writingStreak')}</span>
            </div>
            <div className="home-stat tint-blue">
              <FileText size={18} />
              <strong>{live.length.toLocaleString()}</strong>
              <span>{live.length === 1 ? t('home.pageSingle') : t('home.pagePlural')}</span>
            </div>
            <div className="home-stat tint-green">
              <PenLine size={18} />
              <strong>{words.toLocaleString()}</strong>
              <span>{words === 1 ? t('home.wordSingle') : t('home.wordPlural')}</span>
            </div>
            <button
              type="button"
              className="home-stat tint-purple"
              onClick={() => navigate({ name: 'tasks' })}
            >
              <CircleCheckBig size={18} />
              <strong>{openTasks.length}</strong>
              <span>{openTasks.length === 1 ? t('home.openTaskSingle') : t('home.openTaskPlural')}</span>
            </button>
          </div>

          {live.length === 0 ? (
            <section className="home-empty">
              <h2>{t('home.emptyVaultTitle')}</h2>
              <p>{t('home.emptyVaultBody')}</p>
              <div className="button-row">
                <button type="button" className="button primary" onClick={() => createPage()}>
                  <Plus size={15} /> {t('home.createPageButton')}
                </button>
                <button type="button" className="button" onClick={() => void importMarkdown()}>
                  <FileUp size={15} /> {t('home.importButton')}
                </button>
              </div>
            </section>
          ) : (
            <section className="home-section" aria-labelledby="recent-heading">
              <h2 id="recent-heading" className="section-label">
                {t('home.jumpBackIn')}
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
              {t('home.yourWriting')}
            </h2>
            <Heatmap activity={activity} locale={locale} />
          </section>

          {(memories.length > 0 || again) && (
            <div className="home-pair">
              {memories.length > 0 && (
                <section className="home-section home-memory" aria-labelledby="memory-heading">
                  <h2 id="memory-heading" className="section-label">
                    {t('home.onThisDay')}
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
                    <Shuffle size={12} /> {t('home.rediscover')}
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
                {t('home.openTasks')} <span className="section-count">{openTasks.length}</span>
              </h2>
              <TaskList tasks={openTasks.slice(0, 6)} state={state} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

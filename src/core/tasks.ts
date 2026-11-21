import { dateKey, parseDateKey } from './daily';
import { formatRepeat, nextOccurrence, parseRepeat } from './repeat';
import { inlineText } from './doc';
import type { DocNode, PageId, WorkspaceState } from './model';
import { activePages, ancestorsOf } from './tree';

export interface TaskRef {
  pageId: PageId;
  // position among the page's checklist items in document order
  index: number;
  text: string;
  checked: boolean;
  // the day the task is for, from the first @date written in it, yyyy-mm-dd, and its time of day if any
  date: string | null;
  time: string | null;
  // the day it runs until and the time it ends, and how it repeats, see core/repeat
  end: string | null;
  endTime: string | null;
  repeat: string | null;
}

// documents never change once made, so each one's checklist is read once. the sidebar counts open tasks
// after every edit, which this keeps quick
const taskCache = new WeakMap<DocNode, { pageId: PageId; tasks: TaskRef[] }>();

export function tasksInDoc(pageId: PageId, doc: DocNode): TaskRef[] {
  const cached = taskCache.get(doc);
  if (cached?.pageId === pageId) return cached.tasks;
  const tasks = readTasks(pageId, doc);
  taskCache.set(doc, { pageId, tasks });
  return tasks;
}

function readTasks(pageId: PageId, doc: DocNode): TaskRef[] {
  const tasks: TaskRef[] = [];
  const visit = (node: DocNode) => {
    if (node.type === 'taskItem') {
      const first = node.content?.[0];
      const mention = first?.content?.find((child) => child.type === 'dateMention' && child.attrs?.date);
      const time = mention?.attrs?.time;
      tasks.push({
        pageId,
        index: tasks.length,
        // the date is shown on its own beside the task, so the words leave it out
        text: first
          ? inlineText({ ...first, content: (first.content ?? []).filter((child) => child !== mention) })
              .replace(/\s+/g, ' ')
              .trim()
          : '',
        checked: node.attrs?.checked === true,
        date: typeof mention?.attrs?.date === 'string' ? mention.attrs.date : null,
        time: typeof time === 'string' && /^\d{2}:\d{2}$/.test(time) ? time : null,
        end: typeof mention?.attrs?.end === 'string' ? mention.attrs.end : null,
        endTime: typeof mention?.attrs?.endTime === 'string' ? mention.attrs.endTime : null,
        repeat: typeof mention?.attrs?.repeat === 'string' ? mention.attrs.repeat : null,
      });
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return tasks;
}

// a page left out of Tasks leaves out the pages inside it too
export function tasksHidden(pages: WorkspaceState['pages'], id: PageId): boolean {
  const page = pages[id];
  return !!page && (page.hideTasks || ancestorsOf(pages, id).some((ancestor) => ancestor.hideTasks));
}

export function collectTasks(state: WorkspaceState): TaskRef[] {
  const result: TaskRef[] = [];
  for (const page of activePages(state.pages)) {
    if (tasksHidden(state.pages, page.id)) continue;
    const doc = state.docs[page.id];
    if (doc) result.push(...tasksInDoc(page.id, doc));
  }
  return result;
}

// the next time a task that repeats comes round: the same task unticked, its date moved on. null when it
// doesn't repeat or its repeating has run out
export function nextRepeat(item: DocNode, doneOn: Date): DocNode | null {
  const first = item.content?.[0];
  const mention = first?.content?.find((child) => child.type === 'dateMention' && child.attrs?.repeat);
  const parsed = mention ? parseRepeat(String(mention.attrs!.repeat)) : null;
  if (!first || !mention || !parsed) return null;
  const next = nextOccurrence(
    String(mention.attrs!.date),
    parsed.rule,
    doneOn,
    mention.attrs!.end as string | null,
  );
  if (!next) return null;
  const moved: DocNode = {
    ...mention,
    attrs: { ...mention.attrs, date: next.date, end: next.end, repeat: formatRepeat(next.rule) },
  };
  return {
    ...item,
    attrs: { ...item.attrs, checked: false },
    content: [
      { ...first, content: first.content!.map((child) => (child === mention ? moved : child)) },
      ...(item.content ?? []).slice(1),
    ],
  };
}

// copies only the path to the task, null when the index no longer exists. a repeating task ticked off
// comes round again: its next time is added just above it, the way obsidian's tasks plugin does
export function setTaskChecked(
  doc: DocNode,
  index: number,
  checked: boolean,
  doneOn: Date = new Date(),
): DocNode | null {
  let seen = 0;
  let found = false;
  const visit = (node: DocNode): DocNode => {
    if (found || !node.content) return node;
    let changed = false;
    const content: DocNode[] = [];
    for (const child of node.content) {
      if (!found && child.type === 'taskItem' && seen++ === index) {
        found = true;
        changed = true;
        const repeated = checked && child.attrs?.checked !== true ? nextRepeat(child, doneOn) : null;
        if (repeated) content.push(repeated);
        content.push({ ...child, attrs: { ...child.attrs, checked } });
        continue;
      }
      const next = found ? child : visit(child);
      if (next !== child) changed = true;
      content.push(next);
    }
    return changed ? { ...node, content } : node;
  };
  const next = visit(doc);
  return found ? next : null;
}

// the tasks on each day, for a calendar. a task with no date of its own in a daily note is on that note's day
export function tasksByDay(state: WorkspaceState, tasks: TaskRef[]): Map<string, TaskRef[]> {
  const days = new Map<string, TaskRef[]>();
  const put = (day: string, task: TaskRef) => {
    const list = days.get(day);
    if (list) list.push(task);
    else days.set(day, [task]);
  };
  for (const task of tasks) {
    const day = task.date ?? state.pages[task.pageId]?.dailyDate ?? null;
    if (!day) continue;
    put(day, task);
    // a task that runs over several days is on each of them, for two months at most
    const start = parseDateKey(day);
    const end = task.end ? parseDateKey(task.end) : null;
    if (!start || !end) continue;
    for (let at = 1; at <= 62; at++) {
      const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + at);
      if (next > end) break;
      put(dateKey(next), task);
    }
  }
  for (const list of days.values()) list.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
  return days;
}

export interface TaskChange {
  text: string;
  date: string | null;
  time: string | null;
  end: string | null;
  endTime: string | null;
  repeat: string | null;
  // a page linked from the task, added after its words
  link?: { id: PageId; label: string };
}

// a task's line written again from its details: its words, when it is, and how it repeats. words that
// stay the same keep their formatting and links, new words replace them. null when the task is gone
export function updateTask(doc: DocNode, index: number, change: TaskChange, oldText: string): DocNode | null {
  let seen = 0;
  let found = false;
  const mentionOf = (): DocNode | null =>
    change.date
      ? {
          type: 'dateMention',
          attrs: {
            date: change.date,
            time: change.time,
            ...(change.end ? { end: change.end } : {}),
            ...(change.end && change.endTime ? { endTime: change.endTime } : {}),
            ...(change.repeat ? { repeat: change.repeat } : {}),
          },
        }
      : null;
  const rewrite = (line: DocNode): DocNode => {
    const content = line.content ?? [];
    const mention = mentionOf();
    let words: DocNode[];
    if (change.text.trim() === oldText.trim()) {
      words = content.filter((child) => child.type !== 'dateMention');
      // the space left where the date was
      const last = words[words.length - 1];
      if (last?.type === 'text' && last.text)
        words[words.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') };
    } else words = change.text.trim() ? [{ type: 'text', text: change.text.trim() }] : [];
    const out = words.filter((child) => child.type !== 'text' || child.text);
    if (change.link)
      out.push(
        { type: 'text', text: ' ' },
        { type: 'pageLink', attrs: { id: change.link.id, label: change.link.label } },
      );
    if (mention) out.push({ type: 'text', text: ' ' }, mention);
    return { ...line, content: out };
  };
  const visit = (node: DocNode): DocNode => {
    if (found || !node.content) return node;
    let changed = false;
    const content = node.content.map((child) => {
      if (found) return child;
      if (child.type === 'taskItem' && seen++ === index) {
        found = true;
        changed = true;
        const [first, ...rest] = child.content ?? [];
        return { ...child, content: [rewrite(first ?? { type: 'paragraph', content: [] }), ...rest] };
      }
      const next = visit(child);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, content } : node;
  };
  const next = visit(doc);
  return found ? next : null;
}

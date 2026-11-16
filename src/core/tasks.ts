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

// copies only the path to the task, null when the index no longer exists
export function setTaskChecked(doc: DocNode, index: number, checked: boolean): DocNode | null {
  let seen = 0;
  let found = false;
  const visit = (node: DocNode): DocNode => {
    if (found) return node;
    if (node.type === 'taskItem') {
      if (seen++ === index) {
        found = true;
        return { ...node, attrs: { ...node.attrs, checked } };
      }
    }
    if (!node.content) return node;
    let changed = false;
    const content = node.content.map((child) => {
      const next = visit(child);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, content } : node;
  };
  const next = visit(doc);
  return found ? next : null;
}

// the tasks on each day, for a calendar. a task with no date of its own in a daily note is on that note's day
export function tasksByDay(state: WorkspaceState, tasks: TaskRef[]): Map<string, TaskRef[]> {
  const days = new Map<string, TaskRef[]>();
  for (const task of tasks) {
    const day = task.date ?? state.pages[task.pageId]?.dailyDate ?? null;
    if (!day) continue;
    const list = days.get(day);
    if (list) list.push(task);
    else days.set(day, [task]);
  }
  for (const list of days.values()) list.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
  return days;
}

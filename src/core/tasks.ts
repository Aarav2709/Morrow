import { inlineText } from './doc';
import type { DocNode, PageId, WorkspaceState } from './model';
import { activePages, ancestorsOf } from './tree';

export interface TaskRef {
  pageId: PageId;
  // position among the page's checklist items in document order
  index: number;
  text: string;
  checked: boolean;
}

export function tasksInDoc(pageId: PageId, doc: DocNode): TaskRef[] {
  const tasks: TaskRef[] = [];
  const visit = (node: DocNode) => {
    if (node.type === 'taskItem') {
      const first = node.content?.[0];
      tasks.push({
        pageId,
        index: tasks.length,
        text: first ? inlineText(first).trim() : '',
        checked: node.attrs?.checked === true,
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

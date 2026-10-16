import { Maximize2 } from 'lucide-react';
import { displayTitle } from '../../../core/model';
import type { PageId } from '../../../core/model';
import { openPage } from '../../router';
import { useWorkspace } from '../../workspace';
import { PageIcon } from '../Sidebar';
import { DatabaseView } from './DatabaseView';

// a database living inside another page, with all its views, still a page of its own
export function EmbeddedDatabase({ pageId, editable }: { pageId: PageId; editable: boolean }) {
  const state = useWorkspace();
  const page = state.pages[pageId];
  if (!page?.database) return null;
  return (
    <div className="inline-database">
      <div className="inline-database-head">
        <button type="button" className="inline-database-title" onClick={() => openPage(page.id)}>
          <PageIcon page={page} />
          <span>{displayTitle(page)}</span>
        </button>
        <button
          type="button"
          className="icon-button"
          title="Open as a full page"
          aria-label="Open as a full page"
          onClick={() => openPage(page.id)}
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <DatabaseView page={page} editable={editable} />
    </div>
  );
}

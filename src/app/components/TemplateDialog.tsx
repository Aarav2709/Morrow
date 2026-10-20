import { FilePlus2, LayoutTemplate } from 'lucide-react';
import { displayTitle } from '../../core/model';
import type { PageId } from '../../core/model';
import { findTemplatesPage, listTemplates } from '../../core/templates';
import { createFromTemplate, createPage, createTemplatesPage } from '../operations';
import { closeDialog } from '../ui';
import { useWorkspace } from '../workspace';
import { Dialog } from './primitives';
import { PageIcon } from './Sidebar';
import { t } from '../i18n';

export function TemplateDialog({ parentId }: { parentId: PageId | null }) {
  const state = useWorkspace();
  const templates = listTemplates(state);
  const container = findTemplatesPage(state);
  return (
    <Dialog title={t('actions.items.page_fromTemplate')} onClose={closeDialog}>
      {templates.length === 0 ? (
        <div className="empty-state compact">
          <LayoutTemplate size={24} strokeWidth={1.5} />
          <p>
            Templates are the pages inside your Templates page. Write {'{{date}}'}, {'{{time}}'} or{' '}
            {'{{title}}'} and they are filled in when a page is made from the template. A template called
            “Daily note” is used for every new daily note.
          </p>
          <button
            type="button"
            className="button primary"
            onClick={() => {
              closeDialog();
              if (container) createPage({ parentId: container.id, title: t('dialogs.newTemplate') });
              else createTemplatesPage();
            }}
          >
            <FilePlus2 size={15} /> {t('dialogs.makeATemplate')}
          </button>
        </div>
      ) : (
        <ul className="link-list" role="listbox" aria-label={t('dialogs.templates')}>
          {templates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                className="link-row"
                data-autofocus={template === templates[0] ? true : undefined}
                onClick={() => {
                  closeDialog();
                  createFromTemplate(template.id, parentId);
                }}
              >
                <span className="tree-icon">
                  <PageIcon page={template} />
                </span>
                <span className="link-row-title">{displayTitle(template)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

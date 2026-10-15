import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { DatabaseDef, PageId, PageMeta } from '../../../core/model';
import { Popover } from '../Popover';
import { NewProperty, PropertyInput } from './PropertyValue';

// the values of a database row, shown at the top of its page
export function RowProperties({
  row,
  database,
  dbId,
  editable,
}: {
  row: PageMeta;
  database: DatabaseDef;
  dbId: PageId;
  editable: boolean;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  if (database.properties.length === 0 && !editable) return null;
  return (
    <section className="row-props" aria-label="Properties">
      {database.properties.map((prop) => (
        <div key={prop.id} className="row-prop">
          <span className="row-prop-name">{prop.name}</span>
          <span className="row-prop-value">
            <PropertyInput dbId={dbId} prop={prop} row={row} editable={editable} />
          </span>
        </div>
      ))}
      {editable && (
        <>
          <button
            type="button"
            className="link-button row-prop-add"
            onClick={(event) => setMenu(event.currentTarget)}
          >
            <Plus size={13} /> Add a property
          </button>
          {menu && (
            <Popover anchor={menu} onClose={() => setMenu(null)} label="New property" className="db-panel">
              <NewProperty dbId={dbId} database={database} onDone={() => setMenu(null)} />
            </Popover>
          )}
        </>
      )}
    </section>
  );
}

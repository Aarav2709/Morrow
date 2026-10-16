import { FolderOpen, FolderPlus, History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { desktop } from '../platform/desktop';
import { chooseVaultFolder, createVault, switchVault } from '../vaults';
import { Logo } from './primitives';

// the first screen of the desktop app when no folder is chosen yet
export function VaultChooser({ legacy }: { legacy: number }) {
  const [recent, setRecent] = useState<Array<{ path: string; name: string; exists: boolean }>>([]);
  const [copy, setCopy] = useState(legacy > 0);
  const options = { copyLegacy: copy && legacy > 0 };

  useEffect(() => {
    void desktop?.vault?.state().then((state) => setRecent(state.recent.filter((item) => item.exists)));
  }, []);

  return (
    <div className="boot vault-chooser">
      <Logo size={36} />
      <h1>Where should your notes live?</h1>
      <p className="boot-text">
        Morrow keeps every page as a plain Markdown file in a folder you choose. Open the folder in any other
        app, sync it with any tool you like, or keep it under version control. It is yours.
      </p>
      {legacy > 0 && (
        <label className="vault-legacy">
          <input type="checkbox" checked={copy} onChange={(event) => setCopy(event.target.checked)} />
          <span>
            Copy my {legacy} existing page{legacy === 1 ? '' : 's'} into this folder. The original copy stays
            where it is.
          </span>
        </label>
      )}
      <div className="vault-actions">
        <button type="button" className="data-action" onClick={() => void createVault(options)}>
          <FolderPlus size={20} strokeWidth={1.5} />
          <span>
            <strong>Create a new vault</strong>
            <span className="muted">A new folder called Morrow in your documents.</span>
          </span>
        </button>
        <button type="button" className="data-action" onClick={() => void chooseVaultFolder(options)}>
          <FolderOpen size={20} strokeWidth={1.5} />
          <span>
            <strong>Open a folder</strong>
            <span className="muted">
              Any folder, including an existing vault or a folder of Markdown files.
            </span>
          </span>
        </button>
      </div>
      {recent.length > 0 && (
        <section className="vault-recent" aria-label="Recent vaults">
          <h2 className="section-label">
            <History size={13} /> Recently opened
          </h2>
          <ul className="link-list">
            {recent.map((item) => (
              <li key={item.path}>
                <button
                  type="button"
                  className="link-row"
                  onClick={() => void switchVault(item.path, options)}
                >
                  <span className="link-row-title">
                    {item.name}
                    <span className="link-row-path">{item.path}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

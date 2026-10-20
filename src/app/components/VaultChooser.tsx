import { FolderOpen, FolderPlus, History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import { desktop } from '../platform/desktop';
import { chooseVaultFolder, createVault, switchVault } from '../vaults';
import { Logo } from './primitives';

// the first screen of the desktop app when no folder is chosen yet
export function VaultChooser({ legacy }: { legacy: number }) {
  const { t } = useTranslation();
  const [recent, setRecent] = useState<Array<{ path: string; name: string; exists: boolean }>>([]);
  const [copy, setCopy] = useState(legacy > 0);
  const options = { copyLegacy: copy && legacy > 0 };

  useEffect(() => {
    void desktop?.vault?.state().then((state) => setRecent(state.recent.filter((item) => item.exists)));
  }, []);

  return (
    <div className="boot vault-chooser">
      <Logo size={36} />
      <h1>{t('vaultChooser.title')}</h1>
      <p className="boot-text">
        {t('vaultChooser.body')}
      </p>
      {legacy > 0 && (
        <label className="vault-legacy">
          <input type="checkbox" checked={copy} onChange={(event) => setCopy(event.target.checked)} />
          <span>
            {t('vaultChooser.legacyNotice', { count: legacy })}
          </span>
        </label>
      )}
      <div className="vault-actions">
        <button type="button" className="data-action" onClick={() => void createVault(options)}>
          <FolderPlus size={20} strokeWidth={1.5} />
          <span>
            <strong>{t('vaultChooser.createNewVault')}</strong>
            <span className="muted">{t('vaultChooser.createNewVaultHelp')}</span>
          </span>
        </button>
        <button type="button" className="data-action" onClick={() => void chooseVaultFolder(options)}>
          <FolderOpen size={20} strokeWidth={1.5} />
          <span>
            <strong>{t('vaultChooser.openFolder')}</strong>
            <span className="muted">
              {t('vaultChooser.openFolderHelp')}
            </span>
          </span>
        </button>
      </div>
      {recent.length > 0 && (
        <section className="vault-recent" aria-label={t('vaultChooser.recentVaultsAria')}>
          <h2 className="section-label">
            <History size={13} /> {t('vaultChooser.recentlyOpened')}
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

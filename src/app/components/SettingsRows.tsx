import type { ReactNode } from 'react';

// every part of settings is built from these: titled groups of rows, a label on the left and its control on the right
export function SettingsGroup({
  title,
  help,
  children,
}: {
  title?: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-group-wrap">
      {title && <h4 className="settings-group-title">{title}</h4>}
      <div className="settings-group">{children}</div>
      {help && <p className="settings-group-help">{help}</p>}
    </section>
  );
}

export function SettingRow({
  label,
  help,
  children,
  stacked,
}: {
  label: ReactNode;
  help?: ReactNode;
  children?: ReactNode;
  // the control goes under the label, for wide ones such as a text box
  stacked?: boolean;
}) {
  return (
    <div className={`settings-row${stacked ? ' is-stacked' : ''}`}>
      <div className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {help && <span className="settings-row-help">{help}</span>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

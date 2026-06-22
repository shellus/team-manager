import type { KeyboardEvent, ReactNode } from 'react';

type MetaItem = {
  content: ReactNode;
  className?: string;
  title?: string;
};

export function WorkspaceListCard({
  selected,
  status,
  statusLabel,
  title,
  subtitle,
  meta,
  footnote,
  error,
  menu,
  children,
  onSelect
}: {
  selected: boolean;
  status: string;
  statusLabel: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta: MetaItem[];
  footnote?: ReactNode;
  error?: ReactNode;
  menu?: ReactNode;
  children?: ReactNode;
  onSelect: () => void;
}) {
  const selectOnKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <article
      className={`account-card status-${status} ${selected ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={selectOnKeyboard}
    >
      <div className="card-head">
        <div className="card-title-wrap">
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-sub">{subtitle}</div>}
        </div>
        <div className="card-head-actions">
          <span className={`pill status-${status}`}>{statusLabel}</span>
          {menu}
        </div>
      </div>

      {meta.length > 0 && (
        <div className="card-meta-line">
          {meta.map((item, index) => (
            <span key={index} className={item.className} title={item.title}>
              {item.content}
            </span>
          ))}
        </div>
      )}

      {footnote && <div className="card-footnote">{footnote}</div>}
      {error && <div className="card-error">{error}</div>}
      {children}
    </article>
  );
}

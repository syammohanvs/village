import type { ReactNode } from 'react';
import { errorMessage } from '../lib/api';
import { cx } from '../lib/format';
import { IconAlert, IconRefresh } from './Icons';

export type ChipTone = 'live' | 'warn' | 'bad' | 'neutral' | 'gold';

export function Chip({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: ChipTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={cx('chip', `chip--${tone}`)} title={title}>
      {children}
    </span>
  );
}

export function Card({
  title,
  kicker,
  actions,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  kicker?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={cx('card', className)} id={id}>
      {(title || actions || kicker) && (
        <header className="card-head">
          <div>
            {kicker && <p className="eyebrow">{kicker}</p>}
            {title && <h2 className="card-title">{title}</h2>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'bad' | 'good' | 'gold';
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cx('notice', `notice--${tone}`)}>
      <IconAlert size={16} />
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {children && <p className="hint">{children}</p>}
    </div>
  );
}

export function ErrorBlock({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <div className="notice notice--bad" role="alert">
      <IconAlert size={16} />
      <div>
        <strong>Something did not answer.</strong>
        <p>{errorMessage(error)}</p>
        {onRetry && (
          <button type="button" className="btn btn--ghost btn--small" onClick={onRetry}>
            <IconRefresh size={14} /> Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function KeyValue({
  rows,
}: {
  rows: { label: string; value: ReactNode; title?: string }[];
}) {
  return (
    <dl className="kv">
      {rows.map((row) => (
        <div className="kv-row" key={row.label}>
          <dt>{row.label}</dt>
          <dd title={row.title}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

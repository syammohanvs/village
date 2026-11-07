import type { ReactNode } from 'react';
import { cx } from '../lib/format';
import type { ChipTone } from './ui';

export function KpiCard({
  icon,
  label,
  value,
  sub,
  chip,
  inactive,
  footer,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub: ReactNode;
  chip?: { text: string; tone: ChipTone };
  inactive?: boolean;
  footer?: ReactNode;
}) {
  return (
    <article className={cx('kpi', inactive && 'is-inactive')}>
      <div className="kpi-top">
        <span className="kpi-icon" aria-hidden="true">
          {icon}
        </span>
        {chip && <span className={cx('chip', `chip--${chip.tone}`)}>{chip.text}</span>}
      </div>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      <p className="kpi-sub">{sub}</p>
      {inactive && <p className="kpi-not-live">not live</p>}
      {footer && <div className="kpi-foot">{footer}</div>}
    </article>
  );
}

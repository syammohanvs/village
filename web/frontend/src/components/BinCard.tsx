import { formatAge, formatCm, titleCase } from '../lib/format';
import { binLabel } from '../lib/explain';
import type { BinReading } from '../types';
import { cx } from '../lib/format';
import { IconBin } from './Icons';

const BIN_NAMES: Record<string, string> = {
  organic: 'Organic',
  plastic: 'Plastic',
  paper: 'Paper',
};

function toneFor(state: string): string {
  if (state === 'full') return 'bad';
  if (state === 'nearly_full') return 'warn';
  if (state === 'available') return 'live';
  return 'neutral';
}

export function BinCard({ bin, inactive }: { bin: BinReading; inactive?: boolean }) {
  const name = BIN_NAMES[bin.id] ?? titleCase(bin.id);
  const estimate =
    bin.fill_pct_estimate === null || bin.fill_pct_estimate === undefined
      ? null
      : Math.max(0, Math.min(100, bin.fill_pct_estimate));

  return (
    <article className={cx('bin-card', inactive && 'is-inactive')} data-testid={`bin-${bin.id}`}>
      <header className="bin-head">
        <span className="bin-icon" aria-hidden="true">
          <IconBin size={19} />
        </span>
        <div>
          <p className="bin-name">{name}</p>
          <p className="bin-kind">Estimated fill</p>
        </div>
        <span className={cx('chip', `chip--${toneFor(bin.state)}`)}>{binLabel(bin.state)}</span>
      </header>

      <div className="bin-value">
        {estimate === null ? (
          <span className="bin-unavailable">Unavailable</span>
        ) : (
          <>
            <span className="bin-number">{estimate.toFixed(0)}%</span>
            <span className="bin-unit">estimated fill</span>
          </>
        )}
      </div>

      {estimate !== null && (
        <div className="bin-bar" aria-hidden="true">
          <span
            className={cx('bin-fill', bin.state === 'full' && 'is-full', bin.state === 'nearly_full' && 'is-warn')}
            style={{ width: `${estimate}%` }}
          />
        </div>
      )}

      <dl className="bin-meta">
        <div>
          <dt>Distance</dt>
          <dd>{formatCm(bin.distance_cm)}</dd>
        </div>
        <div>
          <dt>Reading</dt>
          <dd>{formatAge(bin.age_ms)}</dd>
        </div>
      </dl>

      {!bin.installed && <p className="hint">This bin is not installed.</p>}
      {bin.state === 'unavailable' && (
        <p className="hint">
          No usable distance reading{bin.fault ? ` (${bin.fault})` : ''}. The bin is not shown as
          empty.
        </p>
      )}
      {bin.near_blind_zone && <p className="hint">The surface is inside the sensor blind zone.</p>}
      {inactive && <p className="kpi-not-live">not live</p>}
    </article>
  );
}

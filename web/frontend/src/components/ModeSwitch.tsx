import { useId } from 'react';
import { cx } from '../lib/format';
import { useT } from '../lib/i18n';
import type { MessageKey } from '../lib/messages';

/** What the exhibit is showing.  Live is the middle stop, and the default. */
export type VillageMode = 'simulation' | 'live' | 'test';

const STOPS: { id: VillageMode; label: MessageKey; title: MessageKey }[] = [
  { id: 'simulation', label: 'mode.simulation', title: 'mode.simulationTitle' },
  { id: 'live', label: 'mode.live', title: 'mode.liveTitle' },
  { id: 'test', label: 'mode.test', title: 'mode.testTitle' },
];

/**
 * Three stops, one thumb: Simulation · Live · Test.
 *
 * The board's own mode and the firmware's bench test are two different things,
 * so this control is honest about what each stop means: Simulation is invented
 * readings, Live is the controller, and Test takes the five outputs away from
 * the village drivers until its panel is closed.
 */
export function ModeSwitch({
  value,
  onChange,
  testUnavailable,
  lockedReason = null,
}: {
  value: VillageMode;
  onChange: (next: VillageMode) => void;
  /** Why Test cannot be chosen right now, or null when it can. */
  testUnavailable: string | null;
  /**
   * Set when this visit may only use Simulation — a share link.  Live and Test
   * are then drawn disabled with the reason, because a visit that could reach
   * these would be a hand on the village rather than a look at it.
   */
  lockedReason?: string | null;
}) {
  const group = useId();
  const t = useT();
  const index = Math.max(0, STOPS.findIndex((stop) => stop.id === value));

  return (
    <div
      className="mode-switch"
      role="radiogroup"
      aria-label={t('mode.group')}
      data-testid="mode-switch"
      style={{ '--stop': index } as React.CSSProperties}
    >
      <span className="mode-thumb" aria-hidden="true" />
      {STOPS.map((stop) => {
        const locked = lockedReason !== null && stop.id !== 'simulation';
        const disabled =
          locked || (stop.id === 'test' && testUnavailable !== null);
        const reason = locked ? lockedReason : stop.id === 'test' ? testUnavailable : null;
        return (
          <button
            key={stop.id}
            type="button"
            role="radio"
            id={`${group}-${stop.id}`}
            aria-checked={value === stop.id}
            aria-label={t(stop.label)}
            disabled={disabled}
            title={disabled ? (reason ?? t(stop.title)) : t(stop.title)}
            className={cx('mode-stop', value === stop.id && 'is-on')}
            data-testid={`mode-${stop.id}`}
            onClick={() => onChange(stop.id)}
          >
            <span className="mode-dot" aria-hidden="true" />
            <span className="mode-label">{t(stop.label)}</span>
          </button>
        );
      })}
    </div>
  );
}

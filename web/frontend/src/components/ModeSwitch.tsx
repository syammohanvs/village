import { useId } from 'react';
import { cx } from '../lib/format';

/** What the exhibit is showing.  Live is the middle stop, and the default. */
export type VillageMode = 'simulation' | 'live' | 'test';

const STOPS: { id: VillageMode; label: string; title: string }[] = [
  {
    id: 'simulation',
    label: 'Simulation',
    title: 'Invented readings, so the page can be shown without the board.',
  },
  { id: 'live', label: 'Live', title: 'What the controller is reporting now.' },
  {
    id: 'test',
    label: 'Test',
    title: 'Bench test: drive the pump and the four LEDs by hand. Closing the panel returns to live.',
  },
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
}: {
  value: VillageMode;
  onChange: (next: VillageMode) => void;
  /** Why Test cannot be chosen right now, or null when it can. */
  testUnavailable: string | null;
}) {
  const group = useId();
  const index = Math.max(0, STOPS.findIndex((stop) => stop.id === value));

  return (
    <div
      className="mode-switch"
      role="radiogroup"
      aria-label="Village mode"
      data-testid="mode-switch"
      style={{ '--stop': index } as React.CSSProperties}
    >
      <span className="mode-thumb" aria-hidden="true" />
      {STOPS.map((stop) => {
        const disabled = stop.id === 'test' && testUnavailable !== null;
        return (
          <button
            key={stop.id}
            type="button"
            role="radio"
            id={`${group}-${stop.id}`}
            aria-checked={value === stop.id}
            aria-label={stop.label}
            disabled={disabled}
            title={disabled ? testUnavailable : stop.title}
            className={cx('mode-stop', value === stop.id && 'is-on')}
            data-testid={`mode-${stop.id}`}
            onClick={() => onChange(stop.id)}
          >
            <span className="mode-dot" aria-hidden="true" />
            <span className="mode-label">{stop.label}</span>
          </button>
        );
      })}
    </div>
  );
}

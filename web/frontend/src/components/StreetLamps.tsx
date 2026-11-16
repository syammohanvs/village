import { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/format';

/** The metric the firmware reports: brightness = 4095 - raw. */
export const LIGHT_METRIC_MAX = 4095;

/** The exhibit room's own calibration (2026-11-15), which Auto decides on. */
export const DARK_THRESHOLD = 2100;
export const BRIGHT_THRESHOLD = 2500;

/**
 * The five streetlight lamps, drawn white.
 *
 * Five lamps are wired to one pin (D13), so they are always all on or all off —
 * the strip says that honestly rather than inventing five independent lamps.
 * Simulation only: on the board these are the actual LEDs.
 */
export function StreetLampStrip({ on, count = 5 }: { on: boolean; count?: number }) {
  return (
    <div
      className="lamp-strip"
      data-testid="lamp-strip"
      data-on={on ? 'true' : 'false'}
      role="img"
      aria-label={on ? `${count} streetlight lamps, all lit` : `${count} streetlight lamps, all off`}
    >
      {Array.from({ length: Math.max(1, count) }, (_, index) => (
        <span
          key={index}
          className={cx('lamp', on && 'is-on')}
          data-testid={`lamp-${index + 1}`}
          data-on={on ? 'true' : 'false'}
        />
      ))}
    </div>
  );
}

/**
 * "Dark ←→ Light" for the simulated room.
 *
 * The value is the firmware's own brightness metric, so the two thresholds the
 * lamps switch at are the real ones and a slider pushed through them exercises
 * Auto mode rather than a picture of it.  Posts are debounced: a drag is one
 * instruction, not sixty.
 */
export function LightLevelSlider({
  metric,
  onChange,
  disabled,
}: {
  metric: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(metric);
  const timer = useRef<number | undefined>(undefined);

  // Follow the device when it changes somewhere else, but never while this
  // hand is still on the slider.
  useEffect(() => {
    if (timer.current) return;
    setValue(metric);
  }, [metric]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const move = (next: number) => {
    setValue(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      onChange(next);
    }, 180);
  };

  const word =
    value < DARK_THRESHOLD ? 'Dark' : value > BRIGHT_THRESHOLD ? 'Bright' : 'In between';

  return (
    <div className="light-slider" data-testid="light-slider">
      <div className="light-slider-head">
        <span>Dark</span>
        <span className="light-slider-word" data-testid="light-slider-word">
          {word}
        </span>
        <span>Bright</span>
      </div>
      <input
        type="range"
        min={0}
        max={LIGHT_METRIC_MAX}
        step={15}
        value={value}
        disabled={disabled}
        aria-label="Simulated room light"
        onChange={(event) => move(Number(event.target.value))}
      />
      <p className="hint">
        Auto switches the lamps below {DARK_THRESHOLD} and above {BRIGHT_THRESHOLD}; between the two
        it keeps the last decision.
      </p>
    </div>
  );
}

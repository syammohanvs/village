import { useEffect, useId, useRef, useState } from 'react';

/**
 * One simulation input: a named slider with its two ends spelled out.
 *
 * The lab has four of these (soil, outside light, light on the panel, windmill
 * speed), and each one is the same promise: the words at both ends say what the
 * numbers mean, the value in the middle says where it is now, and the control is
 * a real `<input type="range">` so a keyboard can move it and a screen reader
 * announces it (asked for 2026-11-17).
 */
export function SimSlider({
  label: text,
  testId,
  value,
  onChange,
  lowLabel,
  highLabel,
  valueText,
  describe,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  hint,
}: {
  label: string;
  testId: string;
  value: number;
  onChange: (next: number) => void;
  /** What the left end means, e.g. "Dry". */
  lowLabel: string;
  /** What the right end means, e.g. "Wet". */
  highLabel: string;
  /** The current value in words, shown beside the label. */
  valueText: string;
  /**
   * The same words computed from the slider's own position, so a drag reads
   * correctly before the simulator answers.  Without it the label would lag one
   * round trip behind the thumb.
   */
  describe?: (value: number) => string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const [local, setLocal] = useState(value);
  const timer = useRef<number | undefined>(undefined);

  // Follow the simulator when it changes elsewhere, but never while a hand is
  // still on this slider.
  useEffect(() => {
    if (timer.current) return;
    setLocal(value);
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // A drag is one instruction, not ninety: the request goes out once the hand
  // has been still for a moment (the same 180 ms the old light slider used).
  const label = describe ? describe(local) : valueText;

  const move = (next: number) => {
    setLocal(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      onChange(next);
    }, 180);
  };
  return (
    <div className="sim-field" data-testid={testId}>
      <label className="sim-field-label" htmlFor={id}>
        <span>{text}</span>
        <strong data-testid={`${testId}-value`}>{label}</strong>
      </label>
      <input
        id={id}
        className="sim-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.round(local)}
        disabled={disabled}
        aria-label={`${text}: ${label}`}
        onChange={(event) => move(Number(event.target.value))}
      />
      <div className="sim-ends" aria-hidden="true">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
      {hint && <p className="sim-hint">{hint}</p>}
    </div>
  );
}

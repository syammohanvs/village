import { cx } from '../lib/format';

/**
 * The on/off switch used by the bench test — one definition, because the same
 * control is now reached from two places (Setup and the exhibit's test dialog)
 * and two drawings of a switch drift in exactly the details people read: the
 * knob position, the word beside it, and whether it is disabled.
 */
export function Toggle({
  id,
  checked,
  disabled,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx('toggle', checked && 'is-on')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={cx('toggle-track', checked && 'is-on')} aria-hidden="true" data-testid={`${id}-track`}>
        <span className="toggle-knob" />
      </span>
      <span className="toggle-text">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

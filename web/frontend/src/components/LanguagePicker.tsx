import { cx } from '../lib/format';

export interface LanguageOption {
  code: string;
  label: string;
  /** A short qualifier shown under the label, e.g. "text only". */
  note?: string;
}

/**
 * One language selector for the whole app. The voice panel and Lia use the
 * same component so the two cannot drift into different shapes — that
 * discrepancy (rounded gold pills in Lia, browser-default grey rectangles in
 * the voice panel) is exactly what this replaces.
 */
export function LanguagePicker({
  options,
  value,
  onChange,
  label,
  disabled,
  testId,
  className,
}: {
  options: LanguageOption[];
  value: string;
  onChange: (code: string) => void;
  label: string;
  disabled?: boolean;
  /** Prefix for `data-testid="<prefix>-<code>"`. */
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cx('lang-picker', className)} role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.code === value;
        return (
          <button
            key={option.code}
            type="button"
            className={cx('lang-pill', active && 'is-on')}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.code)}
            data-testid={testId ? `${testId}-${option.code}` : undefined}
          >
            <span className="lang-pill-label">{option.label}</span>
            {option.note && <span className="lang-pill-note">{option.note}</span>}
          </button>
        );
      })}
    </div>
  );
}

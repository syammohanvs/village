import { cx } from '../lib/format';
import { useT } from '../lib/i18n';
import type { MessageKey } from '../lib/messages';

// The pin names are the board's own (D21/D22/D23) and are not words.
const BINS: { id: 'organic' | 'plastic' | 'paper'; label: MessageKey; pin: string }[] = [
  { id: 'organic', label: 'bins.organic', pin: 'D21' },
  { id: 'plastic', label: 'bins.plastic', pin: 'D22' },
  { id: 'paper', label: 'bins.paper', pin: 'D23' },
];

/**
 * The three bin indicator LEDs, as the board would light them.
 *
 * Simulation only, and driven by the same signal the real lamps are: the
 * backend sends `INDICATE_WASTE` on an accepted classification, and the demo
 * device holds that category for a few seconds — this reads
 * `status.actuators.waste_indicator`, not the classification result, so what
 * is drawn is exactly what a visitor would see on the bench.
 *
 * A referral (glass, metal, cloth, e-waste) or hazardous waste lights nothing,
 * because no such command is sent for those.
 */
export function BinLeds({ active }: { active: string | null | undefined }) {
  const t = useT();
  const lit = (active ?? '').trim().toLowerCase();
  return (
    <div className="bin-leds" data-testid="bin-leds" data-active={lit || 'none'}>
      <p className="bin-leds-title">{t('bins.title')}</p>
      <div className="bin-leds-row">
        {BINS.map((bin) => {
          const on = lit === bin.id;
          return (
            <span key={bin.id} className={cx('bin-led', on && 'is-on')} data-testid={`bin-led-${bin.id}`}>
              <span className={cx('bin-led-dot', `bin-led-dot--${bin.id}`, on && 'is-on')} aria-hidden="true" />
              <span className="bin-led-label">
                {t(bin.label)}
                <span className="bin-led-pin">{bin.pin}</span>
              </span>
              <span className="bin-led-state">{on ? t('bins.on') : t('bins.off')}</span>
            </span>
          );
        })}
      </div>
      {!lit && <p className="hint">{t('bins.none')}</p>}
    </div>
  );
}

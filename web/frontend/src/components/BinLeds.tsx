import { cx } from '../lib/format';

const BINS = [
  { id: 'organic', label: 'Organic', pin: 'D21' },
  { id: 'plastic', label: 'Plastic', pin: 'D22' },
  { id: 'paper', label: 'Paper', pin: 'D23' },
] as const;

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
  const lit = (active ?? '').trim().toLowerCase();
  return (
    <div className="bin-leds" data-testid="bin-leds" data-active={lit || 'none'}>
      <p className="bin-leds-title">Bin LEDs</p>
      <div className="bin-leds-row">
        {BINS.map((bin) => {
          const on = lit === bin.id;
          return (
            <span key={bin.id} className={cx('bin-led', on && 'is-on')} data-testid={`bin-led-${bin.id}`}>
              <span className={cx('bin-led-dot', `bin-led-dot--${bin.id}`, on && 'is-on')} aria-hidden="true" />
              <span className="bin-led-label">
                {bin.label}
                <span className="bin-led-pin">{bin.pin}</span>
              </span>
              <span className="bin-led-state">{on ? 'on' : 'off'}</span>
            </span>
          );
        })}
      </div>
      {!lit && <p className="hint">No bin LED is lit — nothing has been put in a bin yet.</p>}
    </div>
  );
}

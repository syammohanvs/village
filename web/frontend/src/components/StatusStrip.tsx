import { useDemo } from '../lib/demo';
import { useVillage } from '../lib/village';
import { IconSparkle } from './Icons';

// One line at most. The old strip could stack three warnings and push the
// dashboard below the fold; the cards themselves already say what is unknown.
export function StatusStrip() {
  const { demo, setMode } = useDemo();
  const { simulator } = useVillage();

  if (demo) {
    return (
      <div className="status-strip" aria-live="polite">
        <div className="banner banner--demo" data-testid="demo-banner">
          <IconSparkle size={16} />
          <span>
            <strong>Simulation</strong> — the physical board will not respond. Commands are
            simulated with <code>mode: demo</code>.
          </span>
          <button
            type="button"
            className="banner-action"
            onClick={() => setMode('live')}
            data-testid="back-to-live"
          >
            Back to live readings
          </button>
        </div>
      </div>
    );
  }

  if (simulator) {
    return (
      <div className="status-strip" aria-live="polite">
        <div className="banner banner--sim" data-testid="simulator-badge">
          <IconSparkle size={16} />
          <span>
            <strong>Simulation</strong> — these readings come from the laptop, not the board.
          </span>
        </div>
      </div>
    );
  }

  // No banner for offline or stale: the pill in the top bar already says
  // Offline / Stale / Live, and it carries the raw reason (and the last-frame
  // age) in its tooltip.  A second sentence saying the same thing pushed the
  // cards down for no information (asked for 2026-11-16).
  return null;
}

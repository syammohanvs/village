import { useDemo } from '../lib/demo';
import { formatAge } from '../lib/format';
import { useVillage } from '../lib/village';
import { IconAlert, IconSparkle } from './Icons';

// One line at most. The old strip could stack three warnings and push the
// dashboard below the fold; the cards themselves already say what is unknown.
export function StatusStrip() {
  const { demo, setMode } = useDemo();
  const { connected, stale, simulator, ageMs, connection } = useVillage();

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

  if (!connected) {
    return (
      <div className="status-strip" aria-live="polite">
        <div className="banner banner--offline" role="status" data-testid="offline-banner">
          <IconAlert size={16} />
          <span>
            <strong>Controller offline</strong> — last seen {formatAge(ageMs)}.{' '}
            {connection?.last_error ?? 'The cards stay visible; actions are disabled.'}
          </span>
        </div>
      </div>
    );
  }

  if (stale) {
    return (
      <div className="status-strip" aria-live="polite">
        <div className="banner banner--stale" role="status" data-testid="stale-banner">
          <IconAlert size={16} />
          <span>
            <strong>Last reading {formatAge(ageMs)}</strong> — stale, not live.
          </span>
        </div>
      </div>
    );
  }

  return null;
}

import { useDemo } from '../lib/demo';
import { formatAge } from '../lib/format';
import { useVillage } from '../lib/village';
import { IconAlert, IconInfo, IconSparkle } from './Icons';

export function StatusStrip() {
  const { demo } = useDemo();
  const { connected, stale, connection, simulator, ageMs } = useVillage();

  const lastSeen =
    ageMs === null || ageMs === undefined ? 'no frame received yet' : `last seen ${formatAge(ageMs)}`;

  return (
    <div className="status-strip" aria-live="polite">
      {demo && (
        <div className="banner banner--demo" data-testid="demo-banner">
          <IconInfo size={17} />
          <div>
            <strong>Demo mode</strong> — simulated data, physical controls disabled.
            <span className="banner-detail">
              Commands still go to the same endpoints, marked <code>mode: demo</code>.
            </span>
          </div>
        </div>
      )}

      {simulator && (
        <div className="banner banner--sim" data-testid="simulator-badge">
          <IconSparkle size={16} />
          <div>
            <strong>Simulator</strong>{' '}
            <span className="banner-detail">
              source.kind is “simulator”. Readings are generated on this laptop, not by an ESP32.
            </span>
          </div>
        </div>
      )}

      {!connected && (
        <div className="banner banner--offline" role="status" data-testid="offline-banner">
          <IconAlert size={17} />
          <div>
            <strong>Controller offline</strong> — {lastSeen}, not live.
            <span className="banner-detail">
              {connection?.last_error ?? 'No acknowledgement has arrived from the village controller.'}{' '}
              Missing readings stay blank; they are never replaced with zero.
            </span>
          </div>
        </div>
      )}

      {connected && stale && (
        <div className="banner banner--stale" role="status" data-testid="stale-banner">
          <IconAlert size={17} />
          <div>
            <strong>Last reading is {formatAge(ageMs)}</strong> — stale, not live.
            <span className="banner-detail">
              These are the most recent values; they are not moving and are not a live reading.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

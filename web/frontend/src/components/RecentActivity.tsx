import { Link } from 'react-router-dom';
import { formatUptime, uptimeLabel } from '../lib/format';
import { useVillage } from '../lib/village';
import { Card } from './ui';
import { IconArrowRight } from './Icons';

export function RecentActivity() {
  const { status, live } = useVillage();
  const events = [...(status?.recent_events ?? [])].slice(-5).reverse();

  return (
    <Card
      kicker="Controller events"
      title="Recent activity"
      className="recent-card"
      actions={
        <Link to="/activity" className="link-inline">
          Full history <IconArrowRight size={14} />
        </Link>
      }
    >
      {events.length === 0 ? (
        <p className="hint">
          {live
            ? 'The controller has not reported an event since boot.'
            : 'No controller events have arrived yet.'}
        </p>
      ) : (
        <ul className="activity-mini">
          {events.map((event, index) => (
            <li key={`${event.code ?? 'event'}-${event.at_uptime_ms ?? index}`}>
              <span className="activity-dot" aria-hidden="true" />
              <div>
                <p className="activity-text">{event.text}</p>
                <p className="activity-meta">
                  <code>{event.code ?? 'EVENT'}</code> · {uptimeLabel(event.at_uptime_ms)}
                  {event.at_uptime_ms !== undefined && ` (${formatUptime(event.at_uptime_ms)} after boot)`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

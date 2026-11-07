import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { cx, downloadCsv, formatDateTime } from '../lib/format';
import { useApi } from '../lib/useApi';
import { Card, Chip, EmptyState, ErrorBlock } from '../components/ui';
import { IconDownload } from '../components/Icons';
import type { ActivityEvent } from '../types';

type Kind = 'command' | 'recognition' | 'alert' | 'connection' | 'other';

const KINDS: { id: Kind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'command', label: 'Commands' },
  { id: 'recognition', label: 'Recognitions' },
  { id: 'alert', label: 'Alerts' },
  { id: 'connection', label: 'Connection' },
];

function kindOf(event: ActivityEvent): Kind {
  const raw = `${event.kind ?? ''} ${event.type ?? ''} ${event.code ?? ''}`.toLowerCase();
  if (raw.includes('command')) return 'command';
  if (raw.includes('recogn') || raw.includes('waste')) return 'recognition';
  if (raw.includes('connect') || raw.includes('reconnect') || raw.includes('boot') || raw.includes('offline') || raw.includes('stale')) {
    return 'connection';
  }
  if (raw.includes('alert') || raw.includes('fault') || raw.includes('blocked')) return 'alert';
  return 'other';
}

function eventTime(event: ActivityEvent): string {
  return event.at ?? event.created_at ?? event.timestamp ?? '';
}

function eventText(event: ActivityEvent): string {
  return event.text ?? event.message ?? event.detail ?? event.command ?? 'Event';
}

const KIND_TONE: Record<Kind, 'gold' | 'live' | 'warn' | 'neutral'> = {
  command: 'gold',
  recognition: 'live',
  alert: 'warn',
  connection: 'neutral',
  other: 'neutral',
};

export function Activity() {
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const events = useApi(['events'], () => api.events(200), { intervalMs: 8000 });

  const rows = events.data?.events ?? events.data?.items ?? [];
  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((row) => kindOf(row) === filter)),
    [rows, filter],
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length };
    for (const row of rows) {
      const kind = kindOf(row);
      map[kind] = (map[kind] ?? 0) + 1;
    }
    return map;
  }, [rows]);

  const exportCsv = () => {
    downloadCsv('village-activity.csv', [
      ['time', 'kind', 'event', 'detail', 'result', 'source', 'mode'],
      ...filtered.map((event) => [
        eventTime(event),
        kindOf(event),
        eventText(event),
        event.detail ?? '',
        event.result ?? '',
        event.source ?? '',
        event.mode ?? '',
      ]),
    ]);
  };

  const retention =
    events.data?.retention_days !== undefined
      ? `The backend removes activity older than ${events.data.retention_days} days.`
      : events.data?.retention ??
        'Activity is stored in the local SQLite database and pruned by the backend retention setting.';

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Recorded by the backend</p>
          <h2 className="page-title">Activity history</h2>
          <p className="page-lede">
            Commands, recognitions, alerts and connection changes. Live and demo activity are kept
            separate by the backend.
          </p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={exportCsv} disabled={filtered.length === 0}>
          <IconDownload size={16} /> Export CSV
        </button>
      </div>

      {Boolean(events.error) && <ErrorBlock error={events.error} onRetry={events.reload} />}

      <Card
        kicker="Filters"
        title={
          <span className="filter-title">
            {filtered.length} of {rows.length} events
          </span>
        }
        actions={
          <span className="hint">{events.loading && !events.data ? 'Loading…' : 'Newest first'}</span>
        }
      >
        <div className="filter-row" role="group" aria-label="Filter activity by kind">
          {KINDS.map((kind) => (
            <button
              key={kind.id}
              type="button"
              className={cx('segment', filter === kind.id && 'is-active')}
              aria-pressed={filter === kind.id}
              onClick={() => setFilter(kind.id)}
            >
              {kind.label}
              <span className="segment-count">{counts[kind.id] ?? 0}</span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState title={rows.length === 0 ? 'No activity yet' : 'No events of this kind'}>
            {events.loading
              ? 'Reading the local activity store…'
              : rows.length === 0
                ? 'Commands and recognitions will appear here after the first one is recorded.'
                : 'Choose another filter to see the rest of the history.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table activity-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Kind</th>
                  <th>Event</th>
                  <th>Result</th>
                  <th>Source</th>
                  <th>Mode</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((event, index) => {
                  const kind = kindOf(event);
                  return (
                    <tr key={event.id ?? `${eventTime(event)}-${index}`}>
                      <td className="nowrap">{formatDateTime(eventTime(event))}</td>
                      <td>
                        <Chip tone={KIND_TONE[kind]}>{kind}</Chip>
                      </td>
                      <td className="event-cell">
                        <span>{eventText(event)}</span>
                        {event.code && <code>{event.code}</code>}
                        {event.detail && event.detail !== eventText(event) && (
                          <span className="hint">{event.detail}</span>
                        )}
                      </td>
                      <td>{event.result ?? '—'}</td>
                      <td>{event.source ?? '—'}</td>
                      <td>{event.mode ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="hint page-footnote">
        {retention} The CSV is produced in this browser from the rows on screen; nothing is uploaded.
      </p>
    </div>
  );
}

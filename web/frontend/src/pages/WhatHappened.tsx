import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { cx, downloadCsv, formatDateTime } from '../lib/format';
import { friendlyEvent, kindOf, type EventKind } from '../lib/timeline';
import { useApi } from '../lib/useApi';
import { Card, Chip, EmptyState, ErrorBlock } from '../components/ui';
import { IconDownload } from '../components/Icons';
import type { ActivityEvent } from '../types';

const KINDS: { id: EventKind | 'all'; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'command', label: 'Actions' },
  { id: 'recognition', label: 'Waste' },
  { id: 'alert', label: 'Alerts' },
  { id: 'connection', label: 'Connection' },
];

function eventTime(event: ActivityEvent): string {
  return event.at ?? event.created_at ?? event.timestamp ?? '';
}

function eventDate(event: ActivityEvent): string {
  return formatDateTime(eventTime(event));
}

export function WhatHappened() {
  const [filter, setFilter] = useState<EventKind | 'all'>('all');
  const events = useApi(['events'], () => api.events(200), { intervalMs: 8000 });

  const rows = useMemo(() => {
    const list = events.data?.events ?? events.data?.items ?? [];
    return [...list].sort((a, b) => {
      const left = new Date(eventTime(a)).getTime();
      const right = new Date(eventTime(b)).getTime();
      return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left);
    });
  }, [events.data]);

  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((row) => kindOf(row) === filter)),
    [rows, filter],
  );

  const exportCsv = () => {
    downloadCsv('village-what-happened.csv', [
      ['time', 'kind', 'action', 'reason', 'code', 'source', 'mode', 'request_id'],
      ...filtered.map((event) => {
        const friendly = friendlyEvent(event);
        return [
          eventTime(event),
          friendly.kind,
          friendly.title,
          friendly.reason ?? '',
          event.code ?? '',
          event.source ?? '',
          event.mode ?? '',
          event.id ?? '',
        ];
      }),
    ]);
  };

  return (
    <div className="page">
      {Boolean(events.error) && <ErrorBlock error={events.error} onRetry={events.reload} />}

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={events.loading ? 'Reading the village diary…' : 'Nothing has happened yet'}>
            {events.loading
              ? 'The timeline appears as soon as the backend answers.'
              : 'Watering, lights, voice commands and waste recognitions appear here after the first one is recorded.'}
          </EmptyState>
        </Card>
      ) : (
        <Card
          kicker="Newest first"
          title={`${filtered.length} ${filtered.length === 1 ? 'event' : 'events'}`}
          actions={<span className="hint">Times are shown in this laptop&apos;s clock</span>}
        >
          <ol className="timeline" data-testid="timeline">
            {filtered.map((event, index) => {
              const friendly = friendlyEvent(event);
              return (
                <li key={event.id ?? `${eventTime(event)}-${index}`} className={cx('timeline-item', `timeline-${friendly.kind}`)}>
                  <time className="timeline-time" dateTime={eventTime(event)}>
                    {eventDate(event)}
                  </time>
                  <div className="timeline-body">
                    <p className="timeline-title">{friendly.title}</p>
                    {friendly.reason ? (
                      <p className="timeline-reason">{friendly.reason}</p>
                    ) : (
                      <p className="timeline-reason timeline-reason--none">No reason was recorded.</p>
                    )}
                  </div>
                  <Chip tone={friendly.kind === 'alert' ? 'warn' : friendly.kind === 'recognition' ? 'live' : 'neutral'}>
                    {friendly.kind === 'command' ? 'action' : friendly.kind}
                  </Chip>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <details className="advanced">
        <summary>Advanced details</summary>
        <div className="advanced-body">
          <div className="filter-row" role="group" aria-label="Filter events">
            {KINDS.map((kind) => (
              <button
                key={kind.id}
                type="button"
                className={cx('segment', filter === kind.id && 'is-active')}
                aria-pressed={filter === kind.id}
                onClick={() => setFilter(kind.id)}
              >
                {kind.label}
              </button>
            ))}
          </div>
          <p className="hint">
            Raw records, including codes and request ids. The CSV is built in this browser from the
            rows on screen; nothing is uploaded.
          </p>
          <button type="button" className="btn btn--ghost btn--small" onClick={exportCsv} disabled={filtered.length === 0}>
            <IconDownload size={15} /> Export CSV
          </button>
          <div className="table-wrap">
            <table className="table activity-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Kind</th>
                  <th>Code</th>
                  <th>Detail</th>
                  <th>Source</th>
                  <th>Mode</th>
                  <th>Request</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((event, index) => (
                  <tr key={event.id ?? `${eventTime(event)}-${index}`}>
                    <td className="nowrap">{eventDate(event)}</td>
                    <td>{kindOf(event)}</td>
                    <td>{event.code ? <code>{event.code}</code> : '—'}</td>
                    <td>{event.detail ?? event.text ?? event.message ?? '—'}</td>
                    <td>{event.source ?? '—'}</td>
                    <td>{event.mode ?? '—'}</td>
                    <td>{event.id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}

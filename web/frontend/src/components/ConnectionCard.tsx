import { formatAge, formatDateTime } from '../lib/format';
import { useVillage } from '../lib/village';
import { Card, Chip, KeyValue } from './ui';

export function ConnectionCard() {
  const { envelope, connection, connected, stale, ageMs, simulator } = useVillage();
  const tone = !connected ? 'bad' : stale ? 'warn' : 'live';
  const label = !connected ? 'Offline' : stale ? 'Stale' : 'Live';

  return (
    <Card
      kicker="Laptop ↔ controller"
      title="Connection"
      actions={<Chip tone={tone}>{label}</Chip>}
      className="connection-card"
    >
      {envelope ? (
        <KeyValue
          rows={[
            { label: 'Source', value: envelope.source?.label ?? '—' },
            {
              label: 'Source kind',
              value: <code>{envelope.source?.kind ?? '—'}</code>,
            },
            {
              label: 'Mode',
              value: `${envelope.mode}${simulator ? ' · simulator' : ''}`,
            },
            { label: 'Device', value: connection?.device_id ?? '—' },
            { label: 'Boot', value: connection?.boot_id ?? '—' },
            { label: 'Last frame', value: formatAge(ageMs), title: 'Measured by the laptop' },
            {
              label: 'Last success',
              value: formatDateTime(connection?.last_success_at),
            },
            { label: 'Reconnects', value: connection?.reconnects ?? 0 },
            {
              label: 'Last error',
              value: connection?.last_error ?? 'none',
            },
          ]}
        />
      ) : (
        <p className="hint">
          No envelope yet. The dashboard does not invent a device id, a boot id or a connection
          state.
        </p>
      )}
      <p className="hint">
        The controller has no wall clock. The laptop timestamps every frame and decides when it is
        stale or disconnected.
      </p>
    </Card>
  );
}

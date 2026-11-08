import { useState } from 'react';
import { ApiError, api, errorMessage } from '../lib/api';
import type { CommandOutcome } from '../lib/commands';
import { useCommands } from '../lib/commands';
import { useDemo } from '../lib/demo';
import { cx, formatUptime, titleCase } from '../lib/format';
import { isWatering } from '../lib/explain';
import { useApi } from '../lib/useApi';
import { useVillage } from '../lib/village';
import { CommandResult, COMMAND_LABEL, COMMAND_TONE } from '../components/CommandResult';
import { Card, Chip, EmptyState, ErrorBlock, Notice } from '../components/ui';
import {
  IconAlert,
  IconStop,
  IconWaste,
} from '../components/Icons';
import type { DeviceConfig, DeviceConfigDocument, IrrigationConfig } from '../types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function Toggle({
  id,
  checked,
  disabled,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx('toggle', checked && 'is-on')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
      <span className="toggle-text">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

export function Controls() {
  const { status, live, connected, reload: reloadVillage } = useVillage();
  const { demo } = useDemo();
  const { entries, send, clear } = useCommands();
  const config = useApi<DeviceConfigDocument>(['device-config'], () => api.deviceConfig(), {});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [lastStop, setLastStop] = useState<CommandOutcome | null>(null);
  const [lastWaste, setLastWaste] = useState<CommandOutcome | null>(null);

  const entryFor = (outcome: CommandOutcome | null) =>
    outcome ? entries.find((row) => row.id === outcome.entry.id) ?? outcome.entry : null;

  const irrigation = status?.irrigation;
  const lights = status?.actuators?.streetlights;
  const lightSensor = status?.sensors?.light;
  const watering = isWatering(status);
  const mode = lights?.mode === 'auto' ? 'auto' : lights?.commanded ? 'on' : 'off';
  const physicalDisabled = !connected && !demo;

  const runCommand = async (key: string, type: string, parameters: Record<string, unknown> = {}) => {
    setBusy(key);
    setError('');
    try {
      const outcome = await send(type, parameters);
      if (key === 'stop') setLastStop(outcome);
      if (key.startsWith('waste')) setLastWaste(outcome);
      return outcome;
    } finally {
      setBusy(null);
    }
  };

  const patchIrrigation = async (patch: Partial<IrrigationConfig>, label: string) => {
    if (!config.data) return;
    setBusy(label);
    setError('');
    setNote('');
    try {
      const next: DeviceConfig = clone(config.data.config);
      next.irrigation = { ...next.irrigation, ...patch };
      const response = await api.putDeviceConfig(config.data.config_revision, next);
      const revision = response?.config_revision ?? config.data.config_revision + 1;
      setNote(`${label} saved. Controller configuration revision ${revision}.`);
      config.reload();
      reloadVillage();
    } catch (cause) {
      if (cause instanceof ApiError) {
        const body = cause.body as { reason_code?: string; field?: string } | null;
        const reason = body?.reason_code;
        setError(
          reason === 'PUMP_NOT_COMMISSIONED'
            ? 'The controller refused to open the pump gate: this firmware was not compiled with the pump commissioning key (VILLAGE_PUMP_COMMISSIONED). The gate stays closed.'
            : cause.message,
        );
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setBusy(null);
    }
  };

  const autoEnabled =
    config.data?.config.irrigation.auto_enabled ?? irrigation?.auto_enabled ?? false;
  const gateEnabled = config.data?.config.irrigation.pump_enabled ?? false;
  const commissioned = status?.actuators?.pump?.commissioned ?? false;

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Manual controls</p>
          <h2 className="page-title">Physical commands and their acknowledgements</h2>
          <p className="page-lede">
            Every press sends one command. A confirmed acknowledgement means the controller decided;
            it does not prove water moved or an LED lit.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--danger btn--large"
          data-testid="emergency-stop"
          disabled={busy !== null}
          onClick={() => void runCommand('stop', 'IRRIGATION_STOP')}
        >
          <IconStop size={18} /> Emergency stop irrigation
        </button>
      </div>

      {demo && (
        <Notice tone="warn" title="Demo mode">
          Commands are simulated with <code>mode: demo</code>. No ESP32 is involved.
        </Notice>
      )}
      {!connected && (
        <Notice tone="bad" title="Controller offline">
          Commands cannot be confirmed. Stop stays available so you can still try to stop a session,
          but it will be shown as not confirmed.
        </Notice>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      {note && <Notice tone="good">{note}</Notice>}

      <div className="controls-layout">
        <div className="controls-stack">
          <Card
            kicker="Safety"
            title="Irrigation"
            actions={
              <Chip tone={watering ? 'live' : 'neutral'}>
                {titleCase(irrigation?.state ?? 'unknown')}
              </Chip>
            }
          >
            <p className="control-reason">
              {irrigation?.reason ?? 'No reason has been reported by the controller.'}
            </p>
            <dl className="mini-kv mini-kv--three">
              <div>
                <dt>Pulses</dt>
                <dd>
                  {irrigation?.pulses_done ?? '—'} / {irrigation?.pulse_limit ?? '—'}
                </dd>
              </div>
              <div>
                <dt>Pump time</dt>
                <dd>
                  {formatUptime(irrigation?.cumulative_pump_ms)} /{' '}
                  {formatUptime(irrigation?.max_cumulative_pump_ms)}
                </dd>
              </div>
              <div>
                <dt>Cooldown left</dt>
                <dd>{formatUptime(irrigation?.cooldown_remaining_ms)}</dd>
              </div>
            </dl>

            <div className="setting-row">
              <div>
                <p className="setting-name">Automatic irrigation</p>
                <p className="hint">
                  When on, the controller may start a pulse by itself if soil is dry and every
                  safety check passes.
                </p>
              </div>
              <Toggle
                id="auto-irrigation"
                label="Automatic irrigation"
                checked={Boolean(autoEnabled)}
                disabled={!config.data || physicalDisabled || busy !== null}
                onChange={(next) =>
                  void patchIrrigation({ auto_enabled: next }, 'Automatic irrigation')
                }
              />
            </div>

            <div className="setting-row">
              <div>
                <p className="setting-name">Pump commissioning gate</p>
                <p className="hint">
                  Two keys are required: the firmware must be compiled with the commissioning flag
                  and this setting must allow the pump. {commissioned ? 'The controller currently reports the gate open.' : 'The controller currently reports the gate closed.'}
                </p>
              </div>
              <Toggle
                id="pump-gate"
                label="Pump commissioning gate"
                checked={Boolean(gateEnabled)}
                disabled={!config.data || physicalDisabled || busy !== null}
                onChange={(next) =>
                  void patchIrrigation({ pump_enabled: next }, 'Pump commissioning gate')
                }
              />
            </div>

            <p className="hint">
              The controller still applies soil, water, sensor, cooldown and runtime limits after
              this gate.
            </p>
          </Card>

          <Card kicker="Lighting" title="Streetlights">
            <p className="control-reason">
              {lightSensor && lightSensor.installed === false ? (
                <>
                  No LDR is installed, so there is no light reading. Last output:{' '}
                  {lights?.commanded ? 'commanded on' : 'commanded off'}.
                </>
              ) : (
                <>
                  Sensor reads <strong>{titleCase(lightSensor?.brightness ?? 'unknown')}</strong>.
                  Last output: {lights?.commanded ? 'commanded on' : 'commanded off'}.
                </>
              )}
            </p>
            <div className="segmented segmented--wide" role="group" aria-label="Streetlight mode">
              {(['auto', 'on', 'off'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={cx('segment', mode === value && 'is-active')}
                  aria-pressed={mode === value}
                  disabled={physicalDisabled || busy !== null}
                  onClick={() =>
                    void runCommand(
                      value,
                      value === 'auto' ? 'LIGHTS_AUTO' : value === 'on' ? 'LIGHTS_ON' : 'LIGHTS_OFF',
                    )
                  }
                >
                  {value === 'auto' ? 'Auto' : value === 'on' ? 'On' : 'Off'}
                </button>
              ))}
            </div>
            <p className="hint">
              Auto uses the LDR and a hysteresis band. On and Off are manual overrides; Auto returns
              control to the sensor.
            </p>
          </Card>

          <Card
            kicker="Indicator test"
            title="Waste bin LEDs"
            actions={<IconWaste size={18} />}
          >
            <p className="hint">
              This only lights the bin LED for a few seconds. It is a test of the indicator, not a
              record of anything being deposited.
            </p>
            <div className="waste-test-row">
              {(['organic', 'plastic', 'paper'] as const).map((category) => (
                <button
                  key={category}
                  type="button"
                  className="btn btn--ghost btn--small"
                  data-testid={`indicate-${category}`}
                  disabled={busy !== null || physicalDisabled}
                  onClick={() =>
                    void runCommand(`waste-${category}`, 'INDICATE_WASTE', {
                      category,
                      duration_ms: 8000,
                    })
                  }
                >
                  <IconWaste size={15} /> {titleCase(category)}
                </button>
              ))}
            </div>
            {entryFor(lastWaste) && <CommandResult entry={entryFor(lastWaste)!} />}
          </Card>
        </div>

        <div className="controls-stack">
          <Card
            kicker="Emergency"
            title="Stop now"
            actions={<IconAlert size={18} />}
          >
            <p className="hint">
              <code>IRRIGATION_STOP</code> is idempotent: it is safe to press when nothing is
              running. It is always shown, including while the controller is offline, where it is
              labelled as not confirmed.
            </p>
            <button
              type="button"
              className="btn btn--danger btn--wide"
              data-testid="stop-now"
              disabled={busy !== null}
              onClick={() => void runCommand('stop', 'IRRIGATION_STOP')}
            >
              <IconStop size={18} /> {connected ? 'Stop irrigation' : 'Stop (not confirmed)'}
            </button>
            {watering && (
              <p className="hint">
                The controller reports a session in progress. The pump gate and manual controls are
                separate from this stop.
              </p>
            )}
            {entryFor(lastStop) && <CommandResult entry={entryFor(lastStop)!} />}
          </Card>

          <Card kicker="Log" title="Command log" actions={
            <button type="button" className="btn btn--ghost btn--small" onClick={clear} disabled={entries.length === 0}>
              Clear
            </button>
          }>
            {entries.length === 0 ? (
              <EmptyState title="No commands yet">
                Press something on this page and the request, result and reason appear here.
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table command-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Command</th>
                      <th>Source</th>
                      <th>Mode</th>
                      <th>Result</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="nowrap">{entry.at.toLocaleTimeString()}</td>
                        <td>
                          <code>{entry.type}</code>
                        </td>
                        <td>{entry.source}</td>
                        <td>{entry.mode}</td>
                        <td>
                          <Chip tone={COMMAND_TONE[entry.status]}>{COMMAND_LABEL[entry.status]}</Chip>
                        </td>
                        <td className="reason-cell">
                          {entry.reasonCode && <code>{entry.reasonCode}</code>}
                          {entry.reason && <span>{entry.reason}</span>}
                          {!entry.reason && !entry.reasonCode && entry.status === 'pending' && 'waiting for the controller…'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card kicker="Reference" title="What the controller can refuse">
            <ul className="ref-list">
              <li>
                <code>IRRIGATION_BLOCKED_SOIL_WET</code> — the soil is already wet enough.
              </li>
              <li>
                <code>IRRIGATION_BLOCKED_WATER_LOW</code> — the probes say the water is low.
              </li>
              <li>
                <code>IRRIGATION_BLOCKED_PUMP_NOT_COMMISSIONED</code> — the commissioning gate is
                closed in firmware.
              </li>
              <li>
                <code>IRRIGATION_BLOCKED_COOLDOWN</code> — the post-session lockout is still active.
              </li>
              <li>
                <code>DUPLICATE_COMMAND</code> — this request id was already decided.
              </li>
            </ul>
            <p className="hint">
              A refusal is a successful exchange. It is shown as refused, not as a failed network
              request.
            </p>
          </Card>

          {Boolean(config.error) && <ErrorBlock error={config.error} onRetry={config.reload} />}
          {!live && (
            <p className="hint">
              Readings shown for context are the last frame, not a live reading.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

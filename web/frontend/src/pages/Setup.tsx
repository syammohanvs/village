import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../lib/api';
import { useCommands } from '../lib/commands';
import { useDemo } from '../lib/demo';
import { cx, formatDateTime, formatUptime, titleCase } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useVillage } from '../lib/village';
import { buildLabel } from '../build';
import { validateSettings } from '../lib/validation';
import { CommandResult } from '../components/CommandResult';
import { Sensors } from './Sensors';
import { Card, Chip, EmptyState, ErrorBlock, KeyValue, Notice } from '../components/ui';
import { IconAlert, IconCheck, IconPlug, IconRefresh, IconWaste } from '../components/Icons';
import type {
  AppSettings,
  DeviceConfig,
  DeviceConfigDocument,
  HealthResponse,
  IrrigationConfig,
  SetupChecklist,
} from '../types';

type TestState = 'idle' | 'testing' | 'ok' | 'error';

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
      <span className={cx('toggle-track', checked && 'is-on')} aria-hidden="true" data-testid={`${id}-track`}>
        <span className="toggle-knob" />
      </span>
      <span className="toggle-text">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

function checklistItems(document: SetupChecklist | null) {
  return document?.items ?? document?.checks ?? [];
}

function itemOk(item: { ok?: boolean; status?: string }): boolean {
  return item.ok === true || item.status === 'ok' || item.status === 'pass';
}

function Connections() {
  const health = useApi<HealthResponse>(['system-health'], () => api.systemHealth(), { intervalMs: 15000 });
  const { demo, toggle } = useDemo();
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState('');

  const testDevice = async () => {
    setTestState('testing');
    setTestMessage('');
    try {
      // The device can take a few seconds to time out; without a bound here
      // the button can sit on "Testing…" forever if the request never settles.
      const response = await Promise.race([
        api.deviceHealth(),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error('no answer within 12 seconds')), 12000),
        ),
      ]);
      setTestState('ok');
      setTestMessage(
        [
          'The controller answered.',
          response.device_id ? `Device ${response.device_id}` : '',
          response.firmware ? `firmware ${response.firmware}` : '',
          response.wifi?.ip ? `at ${response.wifi.ip}` : '',
          response.wifi?.ssid ? `on ${response.wifi.ssid}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch (cause) {
      setTestState('error');
      setTestMessage(
        cause instanceof ApiError && cause.status === 404
          ? 'The backend has no /device/health route. Check the backend version.'
          : errorMessage(cause),
      );
    }
  };

  const deviceUrl = health.data?.device?.url ?? health.data?.device_url ?? '—';
  const deviceMode = health.data?.device?.mode ?? health.data?.device_mode ?? '—';
  const reachable = health.data?.device?.reachable ?? health.data?.device?.connected ?? health.data?.connected;

  return (
    <div className="setup-grid">
      <Card
        kicker="Connections"
        title="Where the village controller lives"
        actions={
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => void testDevice()}
            disabled={testState === 'testing'}
          >
            <IconPlug size={15} /> {testState === 'testing' ? 'Testing…' : 'Test connection'}
          </button>
        }
      >
        <KeyValue
          rows={[
            { label: 'Backend', value: health.data?.status ?? (health.error ? 'not answering' : 'checking…') },
            { label: 'App version', value: health.data?.app_version ?? health.data?.version ?? '—' },
            { label: 'Device URL', value: <code>{deviceUrl}</code> },
            { label: 'Device mode', value: titleCase(deviceMode) },
            {
              label: 'Device reachable',
              value: reachable === undefined ? 'not checked — press Test connection' : reachable ? 'yes' : 'no',
            },
            { label: 'Server time', value: formatDateTime(health.data?.server_time ?? health.data?.time) },
          ]}
        />
        {testState !== 'idle' && testState !== 'testing' && (
          <Notice tone={testState === 'ok' ? 'good' : 'bad'}>
            {testState === 'ok' ? <IconCheck size={15} /> : <IconAlert size={15} />} {testMessage}
          </Notice>
        )}
        <p className="hint">The device token never reaches this page.</p>
        <button type="button" className="btn btn--ghost btn--small" onClick={health.reload}>
          <IconRefresh size={14} /> Refresh health
        </button>
      </Card>

      <Card kicker="Simulation" title="Practise without the board">
        <div className="setting-row">
          <div>
            <p className="setting-name">Simulation mode</p>
            <p className="hint">
              Readings and commands are generated on this laptop. The physical board will not
              respond.
            </p>
          </div>
          <Toggle id="simulation" label="Simulation mode" checked={demo} onChange={toggle} />
        </div>
        {demo && (
          <Notice tone="warn">
            <strong>Simulation — the physical board will not respond.</strong> Commands are still
            sent to the same endpoints, marked <code>mode: demo</code>.
          </Notice>
        )}
        <p className="hint">
          Simulation is only ever switched by hand. A connection failure never turns it on silently.
        </p>
      </Card>
    </div>
  );
}

function Preferences() {
  const settings = useApi<AppSettings>(['settings'], () => api.settings(), {});
  const voice = useApi(['voice-readiness'], () => api.voiceReadiness(), { intervalMs: 30000 });
  const model = useApi(['waste-model-setup'], () => api.wasteModelStatus(), { intervalMs: 30000 });
  const [saved, setSaved] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saveError, setSaveError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const forceSync = useRef(false);

  useEffect(() => {
    if (!settings.data) return;
    setSaved(settings.data);
    if (!draft || forceSync.current) {
      setDraft({ ...settings.data });
      forceSync.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  const validation = draft ? validateSettings(draft) : null;
  const dirty = Boolean(
    saved &&
      draft &&
      JSON.stringify({
        language: saved.language,
        tts_enabled: saved.tts_enabled,
        waste_model_path: saved.waste_model_path,
        camera_device_id: saved.camera_device_id,
        waste_confidence: saved.waste_confidence,
        waste_stability_frames: saved.waste_stability_frames,
        waste_cooldown_ms: saved.waste_cooldown_ms,
      }) !==
        JSON.stringify({
          language: draft.language,
          tts_enabled: draft.tts_enabled,
          waste_model_path: draft.waste_model_path,
          camera_device_id: draft.camera_device_id,
          waste_confidence: draft.waste_confidence,
          waste_stability_frames: draft.waste_stability_frames,
          waste_cooldown_ms: draft.waste_cooldown_ms,
        }),
  );

  const update = (patch: Partial<AppSettings>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setMessage('');
    setSaveError('');
  };

  const save = async () => {
    if (!draft) return;
    const invalid = validateSettings(draft);
    if (invalid) {
      setSaveError(invalid);
      return;
    }
    setSaving(true);
    setSaveError('');
    setMessage('');
    try {
      const response = await api.putSettings({
        language: draft.language,
        tts_enabled: draft.tts_enabled,
        waste_model_path: draft.waste_model_path.trim(),
        camera_device_id: draft.camera_device_id || null,
        waste_confidence: draft.waste_confidence,
        waste_stability_frames: draft.waste_stability_frames,
        waste_cooldown_ms: draft.waste_cooldown_ms,
      });
      const next = { ...draft, ...response };
      setSaved(next);
      setDraft({ ...next });
      setMessage(`Settings saved${next.updated_at ? ` · ${formatDateTime(next.updated_at)}` : '.'}`);
    } catch (cause) {
      setSaveError(
        cause instanceof ApiError && cause.status === 409
          ? 'Settings changed elsewhere. Reload before saving.'
          : errorMessage(cause),
      );
    } finally {
      setSaving(false);
    }
  };

  const installed = model.data?.installed ?? model.data?.available ?? model.data?.present;

  return (
    <div className="setup-grid">
      <Card
        kicker="Voice & camera"
        title="Language, spoken replies and recognition"
        actions={
          <span
            className={cx('chip', validation ? 'chip--warn' : dirty ? 'chip--warn' : 'chip--live')}
            data-testid="settings-state"
          >
            {!draft || !saved
              ? settings.error
                ? 'Unavailable'
                : 'Checking…'
              : validation
                ? 'Needs attention'
                : dirty
                  ? 'Unsaved changes'
                  : 'Saved'}
          </span>
        }
      >
        {!draft || !saved ? (
          settings.error ? (
            <ErrorBlock error={settings.error} onRetry={settings.reload} />
          ) : settings.error ? (
            <p className="hint">
              Settings unavailable — the backend did not answer, so no saved values are shown.
            </p>
          ) : (
            <p className="hint">Reading app settings…</p>
          )
        ) : (
          <div className="settings-form">
            <div className="field-grid">
              <label className="field">
                <span>Spoken language</span>
                <select
                  className="select"
                  value={draft.language}
                  onChange={(event) => update({ language: event.target.value })}
                >
                  <option value="en">English</option>
                  <option value="ml">മലയാളം</option>
                  <option value="hi">हिन्दी</option>
                </select>
              </label>
              <div className="setting-row setting-row--compact">
                <div>
                  <p className="setting-name">Spoken replies</p>
                  <p className="hint">Prepared recordings first, then the browser voice.</p>
                </div>
                <Toggle
                  id="tts"
                  label="Spoken replies"
                  checked={draft.tts_enabled}
                  onChange={(next) => update({ tts_enabled: next })}
                />
              </div>
            </div>

            <label className="field">
              <span>Waste model folder</span>
              <input
                className="input"
                aria-label="Waste model folder"
                value={draft.waste_model_path}
                onChange={(event) => update({ waste_model_path: event.target.value })}
                placeholder="/models/waste/"
              />
            </label>

            <label className="field">
              <span>Preferred camera device id</span>
              <input
                className="input"
                value={draft.camera_device_id ?? ''}
                onChange={(event) => update({ camera_device_id: event.target.value })}
                placeholder="Leave blank for the default camera"
              />
            </label>

            <div className="field-grid field-grid--three">
              <label className="field">
                <span>Confidence threshold</span>
                <input
                  className="input"
                  type="number"
                  step={0.01}
                  min={0.3}
                  max={0.99}
                  value={draft.waste_confidence}
                  onChange={(event) => update({ waste_confidence: Number(event.target.value) })}
                />
              </label>
              <label className="field">
                <span>Stable frames</span>
                <input
                  className="input"
                  type="number"
                  step={1}
                  min={2}
                  max={20}
                  value={draft.waste_stability_frames}
                  onChange={(event) => update({ waste_stability_frames: Number(event.target.value) })}
                />
              </label>
              <label className="field">
                <span>Cooldown (ms)</span>
                <input
                  className="input"
                  type="number"
                  step={500}
                  min={1000}
                  max={60000}
                  value={draft.waste_cooldown_ms}
                  onChange={(event) => update({ waste_cooldown_ms: Number(event.target.value) })}
                />
              </label>
            </div>

            {validation && (
              <p className="error-text" data-testid="settings-validation">
                {validation}
              </p>
            )}
            {saveError && <Notice tone="bad">{saveError}</Notice>}
            {message && <Notice tone="good">{message}</Notice>}

            <div className="form-actions">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={!dirty || saving}
                onClick={() => saved && setDraft({ ...saved })}
              >
                Discard
              </button>
              <button
                type="button"
                className="btn btn--primary btn--small"
                data-testid="save-settings"
                disabled={!dirty || Boolean(validation) || saving}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
            <p className="hint">
              {dirty ? 'Your draft has not been sent yet.' : `Saved${saved.updated_at ? ` at ${formatDateTime(saved.updated_at)}` : ''}.`}
            </p>
          </div>
        )}
      </Card>

      <Card kicker="Readiness" title="Speech and camera services">
        <div className="setting-row">
          <div>
            <p className="setting-name">Speech recognition</p>
            <p className="hint">
              {voice.data?.whisper?.message ??
                (voice.data?.whisper?.ready ? 'Whisper is ready on this laptop.' : 'Checking the local Whisper service…')}
            </p>
          </div>
          <Chip tone={voice.data?.whisper?.ready ? 'live' : voice.error ? 'warn' : 'neutral'}>
            {voice.data?.whisper?.ready ? 'Ready' : voice.error ? 'Unknown' : 'Checking'}
          </Chip>
        </div>
        <div className="setting-row">
          <div>
            <p className="setting-name">Waste recognition model</p>
            <p className="hint">
              {model.error
                ? 'The model status could not be read.'
                : installed
                  ? 'The model files are installed and the browser can load them.'
                  : 'No model files in the folder above. The camera will not guess.'}
            </p>
          </div>
          <Chip tone={model.error ? 'neutral' : installed ? 'live' : 'warn'}>
            {model.error ? 'Unknown' : installed ? 'Installed' : 'Missing'}
          </Chip>
        </div>
        <p className="hint">
          Speech runs on this laptop. Camera recognition runs in the browser tab. Neither is sent to
          a cloud service.
        </p>
      </Card>
    </div>
  );
}

function Irrigation() {
  const { status, live, connected, reload: reloadVillage } = useVillage();
  const { demo } = useDemo();
  const config = useApi<DeviceConfigDocument>(
    ['device-config', demo ? 'demo' : 'live'],
    () => api.deviceConfig(demo ? 'demo' : 'live'),
    {},
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const irrigation = status?.irrigation;
  const commissioned = status?.actuators?.pump?.commissioned ?? false;
  const physicalDisabled = !connected && !demo;

  const apply = async (patch: Partial<IrrigationConfig>, label: string) => {
    if (!config.data) return;
    setBusy(label);
    setError('');
    setNote('');
    try {
      const next: DeviceConfig = clone(config.data.config);
      next.irrigation = { ...next.irrigation, ...patch };
      const response = await api.putDeviceConfig(config.data.config_revision, next, demo ? 'demo' : 'live');
      const revision = response?.config_revision ?? config.data.config_revision + 1;
      setNote(`${label} saved. Controller configuration revision ${revision}.`);
      config.reload();
      reloadVillage();
    } catch (cause) {
      const body = cause instanceof ApiError ? (cause.body as { reason_code?: string } | null) : null;
      setError(
        body?.reason_code === 'PUMP_NOT_COMMISSIONED'
          ? 'The controller refused to open the pump gate: this firmware was not compiled with the pump commissioning key.'
          : errorMessage(cause),
      );
    } finally {
      setBusy(null);
    }
  };

  const autoEnabled = config.data?.config.irrigation.auto_enabled ?? irrigation?.auto_enabled ?? false;
  const gateEnabled = config.data?.config.irrigation.pump_enabled ?? false;
  const cfg = config.data?.config.irrigation;

  const numberField = (
    label: string,
    key: keyof IrrigationConfig,
    min: number,
    max: number,
  ) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={key === 'cooldown_ms' ? 1000 : 500}
        value={Number(cfg?.[key] ?? 0)}
        disabled={!cfg || busy !== null || physicalDisabled}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (!Number.isFinite(value)) return;
          void apply({ [key]: value } as Partial<IrrigationConfig>, label);
        }}
      />
    </label>
  );

  return (
    <Card
      kicker="Pump & irrigation"
      title="Commissioning and safe limits"
      actions={<Chip tone={wateringLabel(irrigation?.state)}>{titleCase(irrigation?.state ?? 'unknown')}</Chip>}
    >
      <p className="hint">
        Two keys are required before the pump can run: the firmware commissioning flag and this
        gate. The controller still applies soil, water, sensor, cooldown and runtime limits.
      </p>
      <div className="setting-row">
        <div>
          <p className="setting-name">Automatic irrigation</p>
          <p className="hint">The controller may start a pulse by itself when the soil is dry.</p>
        </div>
        <Toggle
          id="auto-irrigation"
          label="Automatic irrigation"
          checked={Boolean(autoEnabled)}
          disabled={!config.data || physicalDisabled || busy !== null}
          onChange={(next) => void apply({ auto_enabled: next }, 'Automatic irrigation')}
        />
      </div>
      <div className="setting-row">
        <div>
          <p className="setting-name">Pump commissioning gate</p>
          <p className="hint">
            {commissioned
              ? 'The controller reports the gate open.'
              : 'The controller reports the gate closed.'}{' '}
            Open it only when the pump is in water and the bench test is done.
          </p>
        </div>
        <Toggle
          id="pump-gate"
          label="Pump commissioning gate"
          checked={Boolean(gateEnabled)}
          disabled={!config.data || physicalDisabled || busy !== null}
          onChange={(next) => void apply({ pump_enabled: next }, 'Pump commissioning gate')}
        />
      </div>

      <details className="advanced">
        <summary>Pulse, runtime and cooldown</summary>
        <div className="advanced-body">
          <div className="field-grid field-grid--three">
            {numberField('Pulse length (ms)', 'pulse_ms', 500, 15000)}
            {numberField('Maximum pulse (ms)', 'max_pulse_ms', 500, 30000)}
            {numberField('Soak between pulses (ms)', 'soak_ms', 1000, 600000)}
            {numberField('Maximum total pumping (ms)', 'max_cumulative_ms', 5000, 120000)}
            {numberField('Cooldown after a session (ms)', 'cooldown_ms', 0, 3600000)}
            {numberField('Stop if the laptop is gone (ms)', 'link_timeout_ms', 5000, 300000)}
          </div>
          <p className="hint">
            Each value saves as soon as it changes. The controller is the authority on these
            limits.
          </p>
        </div>
      </details>

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
            {formatUptime(irrigation?.cumulative_pump_ms)} / {formatUptime(irrigation?.max_cumulative_pump_ms)}
          </dd>
        </div>
        <div>
          <dt>Cooldown left</dt>
          <dd>{formatUptime(irrigation?.cooldown_remaining_ms)}</dd>
        </div>
      </dl>

      {error && <Notice tone="bad">{error}</Notice>}
      {note && <Notice tone="good">{note}</Notice>}
      {!live && <p className="hint">Readings shown here are the last frame, not a live reading.</p>}
      {Boolean(config.error) && <ErrorBlock error={config.error} onRetry={config.reload} />}
    </Card>
  );
}

function wateringLabel(state: string | undefined): 'live' | 'warn' | 'neutral' {
  if (state === 'pumping' || state === 'soaking') return 'live';
  if (state === 'cooldown' || state === 'blocked') return 'warn';
  return 'neutral';
}

function WasteLeds() {
  const { send, entries } = useCommands();
  const { connected, demo } = useVillage();
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const physicalDisabled = !connected && !demo;

  return (
    <Card kicker="Indicator test" title="Bin LEDs" actions={<IconWaste size={18} />}>
      <p className="hint">
        This only lights the bin LED for a few seconds. It is a test of the indicator, not a record
        of anything being deposited.
      </p>
      <div className="waste-test-row">
        {(['organic', 'plastic', 'paper'] as const).map((category) => (
          <button
            key={category}
            type="button"
            className="btn btn--ghost btn--small"
            data-testid={`indicate-${category}`}
            disabled={busy !== null || physicalDisabled}
            onClick={async () => {
              setBusy(category);
              try {
                const outcome = await send('INDICATE_WASTE', { category, duration_ms: 8000 });
                setLast(outcome.entry.id);
              } finally {
                setBusy(null);
              }
            }}
          >
            <IconWaste size={15} /> {titleCase(category)}
          </button>
        ))}
      </div>
      {last && entries.find((row) => row.id === last) && (
        <CommandResult entry={entries.find((row) => row.id === last)!} />
      )}
      {physicalDisabled && <p className="hint">The controller is offline, so the LEDs cannot be tested.</p>}
    </Card>
  );
}

function CommandLog() {
  const { entries, clear } = useCommands();
  return (
    <Card
      kicker="Diagnostics"
      title="Command log"
      actions={
        <button type="button" className="btn btn--ghost btn--small" onClick={clear} disabled={entries.length === 0}>
          Clear
        </button>
      }
    >
      {entries.length === 0 ? (
        <EmptyState title="No commands yet">Press something and the request and result appear here.</EmptyState>
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
                  <td>{titleCase(entry.status)}</td>
                  <td className="reason-cell">
                    {entry.reasonCode && <code>{entry.reasonCode}</code>}
                    {entry.reason && <span>{entry.reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Diagnostics() {
  const health = useApi<HealthResponse>(['system-health'], () => api.systemHealth(), { intervalMs: 15000 });
  return (
    <Card kicker="Technical" title="Connection diagnostics">
      <p className="hint" data-testid="build-stamp">
        Dashboard build: <strong>{buildLabel()}</strong>. If this is older than the last rebuild,
        this tab is still running the previous page — reload it with Ctrl+Shift+R.
      </p>
      <details className="advanced">
        <summary>Raw health response</summary>
        <div className="advanced-body">
          <pre className="code-block">{JSON.stringify(health.data ?? { error: errorMessage(health.error) }, null, 2)}</pre>
        </div>
      </details>
      <p className="hint">
        Human-readable messages are shown on the cards. The raw payload stays here for a presenter.
      </p>
    </Card>
  );
}

function Checklist() {
  const checklist = useApi<SetupChecklist>(['setup-checklist'], () => api.setupChecklist(), { intervalMs: 60000 });
  const items = checklistItems(checklist.data);
  const readyCount = items.filter(itemOk).length;

  return (
    <Card
      kicker="Before the exhibition"
      title="Readiness checklist"
      actions={
        items.length > 0 && (
          <Chip tone={readyCount === items.length ? 'live' : 'warn'}>
            {readyCount} / {items.length} ready
          </Chip>
        )
      }
    >
      {checklist.error ? (
        <>
          <ErrorBlock error={checklist.error} onRetry={checklist.reload} />
          <ul className="checklist checklist--manual">
            <li className="is-missing">
              <span className="check-icon" aria-hidden="true">
                <IconAlert size={15} />
              </span>
              <div>
                <p className="check-label">Local checks (not confirmed by the service)</p>
                <p className="hint">
                  The service could not confirm anything, so walk these by hand: optics and probes
                  seated, tank water above the probes, pump submerged, camera connected, the four
                  lamps lit, and the board joined to the venue Wi-Fi.
                </p>
              </div>
            </li>
          </ul>
        </>
      ) : items.length === 0 ? (
        <EmptyState title={checklist.loading ? 'Reading the checklist…' : 'No checklist items'}>
          The backend returns the pre-exhibition checks here when it has them.
        </EmptyState>
      ) : (
        <ul className="checklist">
          {items.map((item, index) => (
            <li key={item.id ?? item.key ?? index} className={cx(itemOk(item) ? 'is-ok' : 'is-missing')}>
              <span className="check-icon" aria-hidden="true">
                {itemOk(item) ? <IconCheck size={15} /> : <IconAlert size={15} />}
              </span>
              <div>
                <p className="check-label">{item.label}</p>
                {(item.detail || item.message) && <p className="hint">{item.detail ?? item.message}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Setup() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(hash.replace('#', ''));
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  return (
    <div className="page setup-page">
      <nav className="setup-jump" aria-label="Setup sections">
        <a href="#connections">Connections</a>
        <a href="#sensors">Sensors &amp; Calibration</a>
        <a href="#voice-camera">Voice &amp; Camera</a>
        <a href="#advanced">Advanced</a>
      </nav>

      <section id="connections" className="setup-section">
        <h2 className="setup-title">Connections</h2>
        <Connections />
      </section>

      <section id="sensors" className="setup-section">
        <h2 className="setup-title">Sensors &amp; Calibration</h2>
        <Sensors embedded />
      </section>

      <section id="voice-camera" className="setup-section">
        <h2 className="setup-title">Voice &amp; Camera</h2>
        <Preferences />
      </section>

      <section id="advanced" className="setup-section">
        <h2 className="setup-title">Advanced</h2>
        <div className="setup-stack">
          <Irrigation />
          <div className="setup-grid">
            <WasteLeds />
            <CommandLog />
          </div>
          <div className="setup-grid">
            <Checklist />
            <Diagnostics />
          </div>
        </div>
        <p className="hint">
          Looking for the demo scenarios or raw calibration? Calibration is under{' '}
          <a href="#sensors">Sensors &amp; Calibration</a>; the safe practice mode is under{' '}
          <Link to="/setup#connections">Connections</Link>.
        </p>
      </section>
    </div>
  );
}

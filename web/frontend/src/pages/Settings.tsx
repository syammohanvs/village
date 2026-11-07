import { useEffect, useRef, useState } from 'react';
import { ApiError, api, errorMessage } from '../lib/api';
import { useApi } from '../lib/useApi';
import { cx, formatDateTime, titleCase } from '../lib/format';
import { validateSettings } from '../lib/validation';
import { Card, Chip, EmptyState, ErrorBlock, KeyValue, Notice } from '../components/ui';
import { IconAlert, IconCheck, IconPlug, IconRefresh } from '../components/Icons';
import type { AppSettings, HealthResponse, SetupChecklist } from '../types';

type TestState = 'idle' | 'testing' | 'ok' | 'error';

function checklistItems(document: SetupChecklist | null) {
  return document?.items ?? document?.checks ?? [];
}

function itemOk(item: { ok?: boolean; status?: string }): boolean {
  return item.ok === true || item.status === 'ok' || item.status === 'pass';
}

export function Settings() {
  const health = useApi<HealthResponse>(['system-health'], () => api.systemHealth(), { intervalMs: 15000 });
  const settings = useApi<AppSettings>(['settings'], () => api.settings(), {});
  const checklist = useApi<SetupChecklist>(['setup-checklist'], () => api.setupChecklist(), { intervalMs: 60000 });

  const [saved, setSaved] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saveError, setSaveError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState('');
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
      setSaveError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const testDevice = async () => {
    setTestState('testing');
    setTestMessage('');
    try {
      const response = await api.deviceHealth();
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
  const items = checklistItems(checklist.data);
  const readyCount = items.filter(itemOk).length;

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Laptop setup</p>
          <h2 className="page-title">Connection, services and preferences</h2>
          <p className="page-lede">
            Everything here is local. The browser talks to the FastAPI backend on this laptop, and
            the backend talks to the ESP32 on the private network.
          </p>
        </div>
        <Chip tone={reachable ? 'live' : reachable === false ? 'bad' : 'neutral'}>
          {reachable === true ? 'Controller reachable' : reachable === false ? 'Controller unreachable' : 'Unknown'}
        </Chip>
      </div>

      {Boolean(health.error) && <ErrorBlock error={health.error} onRetry={health.reload} />}

      <div className="settings-grid">
        <Card
          kicker="Device connection"
          title="Where the village controller lives"
          actions={
            <button type="button" className="btn btn--ghost btn--small" onClick={() => void testDevice()} disabled={testState === 'testing'}>
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
              { label: 'Device reachable', value: reachable === undefined ? 'not reported' : reachable ? 'yes' : 'no' },
              { label: 'Server time', value: formatDateTime(health.data?.server_time) },
            ]}
          />
          {testState !== 'idle' && testState !== 'testing' && (
            <Notice tone={testState === 'ok' ? 'good' : 'bad'}>
              {testState === 'ok' ? <IconCheck size={15} /> : <IconAlert size={15} />} {testMessage}
            </Notice>
          )}
          <p className="hint">
            The device token never reaches this page. The backend keeps it and adds it to each
            controller request.
          </p>
          <button type="button" className="btn btn--ghost btn--small" onClick={health.reload}>
            <IconRefresh size={14} /> Refresh health
          </button>
        </Card>

        <Card
          kicker="App preferences"
          title="Voice, camera and recognition"
          actions={
            <span className={cx('chip', validation ? 'chip--warn' : dirty ? 'chip--warn' : 'chip--live')} data-testid="settings-state">
              {validation ? 'Needs attention' : dirty ? 'Unsaved changes' : 'Saved'}
            </span>
          }
        >
          {!draft || !saved ? (
            settings.error ? (
              <ErrorBlock error={settings.error} onRetry={settings.reload} />
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
                    <p className="hint">Try a prepared local recording first, then the browser voice.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.tts_enabled}
                    aria-label="Spoken replies"
                    className={cx('toggle', draft.tts_enabled && 'is-on')}
                    onClick={() => update({ tts_enabled: !draft.tts_enabled })}
                  >
                    <span className="toggle-track" aria-hidden="true">
                      <span className="toggle-knob" />
                    </span>
                    <span className="toggle-text">{draft.tts_enabled ? 'On' : 'Off'}</span>
                  </button>
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
                {dirty
                  ? 'Your draft has not been sent yet.'
                  : `Saved${saved.updated_at ? ` at ${formatDateTime(saved.updated_at)}` : ''}.`}
              </p>
            </div>
          )}
        </Card>
      </div>

      <Card
        kicker="Before the exhibition"
        title="Setup checklist"
        actions={
          items.length > 0 && (
            <Chip tone={readyCount === items.length ? 'live' : 'warn'}>
              {readyCount} / {items.length} ready
            </Chip>
          )
        }
      >
        {checklist.error ? (
          <ErrorBlock error={checklist.error} onRetry={checklist.reload} />
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

      <Card kicker="First run" title="A sensible order">
        <ol className="steps-list">
          <li>Start the backend on this laptop and open the dashboard.</li>
          <li>
            Put the controller on the same private network, set its address in the backend
            environment, and press <strong>Test connection</strong> above.
          </li>
          <li>Calibrate the soil probe and the reservoir probes on the Sensors page.</li>
          <li>Open the pump commissioning gate only when the plumbing is ready.</li>
          <li>Download the local whisper model and install the waste model folder.</li>
          <li>Try one voice command and one camera recognition before visitors arrive.</li>
        </ol>
        <p className="hint">
          The simulator is available from the Demo switch in the header. It is the safe way to
          practise the whole flow before connecting real hardware.
        </p>
      </Card>
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, errorMessage } from '../lib/api';
import { useDemo } from '../lib/demo';
import { cx, formatAge, formatCm, formatMv, formatPercent, titleCase } from '../lib/format';
import { binLabel, reservoirLabel, soilLabel } from '../lib/explain';
import { useApi } from '../lib/useApi';
import { useVillage } from '../lib/village';
import { Card, Chip, ErrorBlock, Notice } from '../components/ui';
import { IconAlert, IconInfo, IconRefresh } from '../components/Icons';
import type { DeviceConfig, DeviceConfigDocument } from '../types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validate(config: DeviceConfig): string | null {
  const soil = config.soil;
  if (![soil.dry_raw, soil.wet_raw].every((value) => Number.isInteger(value) && value >= 0 && value <= 4095)) {
    return 'Soil endpoints must be whole raw ADC values between 0 and 4095.';
  }
  const span = Math.abs(soil.dry_raw - soil.wet_raw);
  const minSpan = soil.min_span_raw || 400;
  if (span < minSpan) {
    return `The two soil endpoints only differ by ${span} raw counts. They must differ by at least ${minSpan}, or the calibration is too flat to be useful.`;
  }

  const reservoir = config.reservoir;
  for (const value of [reservoir.wet_threshold_mv, reservoir.dry_threshold_mv]) {
    if (!Number.isInteger(value) || value < 50 || value > 3200) {
      return 'Reservoir thresholds must be whole millivolt values between 50 and 3200.';
    }
  }
  if (reservoir.wet_threshold_mv >= reservoir.dry_threshold_mv) {
    return 'The wet threshold must be below the dry threshold. A lower millivolt reading means the probes are covered by water.';
  }

  for (const bin of config.bins) {
    if (!(bin.full_cm > 0 && bin.empty_cm > bin.full_cm)) {
      return `${titleCase(bin.id)} bin: the full distance must be smaller than the empty distance, and both must be above zero.`;
    }
  }

  const light = config.light;
  if (!(light.bright_threshold > light.dark_threshold)) {
    return 'The bright LDR threshold must be above the dark threshold.';
  }

  return null;
}

export function Sensors({ embedded = false }: { embedded?: boolean } = {}) {
  const { status, live, simulator } = useVillage();
  const { demo } = useDemo();
  const config = useApi<DeviceConfigDocument>(['device-config'], () => api.deviceConfig(), {});
  const [saved, setSaved] = useState<DeviceConfigDocument | null>(null);
  const [draft, setDraft] = useState<DeviceConfig | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState('');
  const [saving, setSaving] = useState(false);
  const forceSync = useRef(false);

  useEffect(() => {
    const doc = config.data;
    if (!doc?.config) return;
    setSaved(doc);
    if (!draft || forceSync.current) {
      setDraft(clone(doc.config));
      forceSync.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.data]);

  const soil = status?.sensors?.soil;
  const reservoir = status?.sensors?.reservoir;
  const light = status?.sensors?.light;
  const bins = status?.sensors?.bins ?? [];
  const inactive = !live;
  const dirty = Boolean(saved && draft && JSON.stringify(saved.config) !== JSON.stringify(draft));

  const update = (mutate: (next: DeviceConfig) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = clone(current);
      mutate(next);
      return next;
    });
    setMessage('');
  };

  const reloadConfig = () => {
    forceSync.current = true;
    setConflict('');
    config.reload();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !saved) return;
    setError('');
    setMessage('');
    const invalid = validate(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    try {
      const response = await api.putDeviceConfig(saved.config_revision, draft);
      const nextConfig = response?.config ?? draft;
      const nextRevision = response?.config_revision ?? saved.config_revision + 1;
      setSaved({ ...saved, config_revision: nextRevision, config: nextConfig });
      setDraft(clone(nextConfig));
      setMessage(`Saved. The controller is now on configuration revision ${nextRevision}.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const body = cause.body as { config_revision?: number; revision?: number } | null;
        const revision = body?.config_revision ?? body?.revision;
        setConflict(
          `The controller has a newer configuration${revision ? ` (revision ${revision})` : ''}. Nothing was overwritten. Reload the controller configuration before editing again.`,
        );
      } else if (cause instanceof ApiError && cause.status === 400) {
        setError(cause.message);
      } else {
        setError(errorMessage(cause));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cx('page', embedded && 'embedded-page')}>
      {!embedded && (
        <div className="page-intro">
          <div>
            <p className="eyebrow">Raw readings first</p>
            <h2 className="page-title">What the probes actually report</h2>
            <p className="page-lede">
              These are the controller&apos;s own values. Calibration changes how the raw numbers are
              interpreted; it does not make them more precise than the probes allow.
            </p>
          </div>
          {draft && saved && (
            <Chip tone={dirty ? 'warn' : 'live'}>
              {dirty ? 'Unsaved changes' : `Saved · revision ${saved.config_revision}`}
            </Chip>
          )}
        </div>
      )}
      {embedded && draft && saved && (
        <p className="hint embedded-note">
          {dirty ? 'Unsaved calibration changes.' : `Calibration saved · revision ${saved.config_revision}`}
        </p>
      )}

      {Boolean(config.error) && <ErrorBlock error={config.error} onRetry={config.reload} />}

      {error && <Notice tone="bad" title="Not saved">{error}</Notice>}

      {conflict && (
        <Notice tone="bad" title="Configuration conflict">
          <p>{conflict}</p>
          <button type="button" className="btn btn--ghost btn--small" onClick={reloadConfig}>
            <IconRefresh size={14} /> Reload from controller
          </button>
        </Notice>
      )}

      {message && <Notice tone="good">{message}</Notice>}

      <div className="reading-grid">
        <Card kicker="Soil" title="Moisture probe">
          <div className={cx('reading-value', inactive && 'is-inactive')}>
            <span className="reading-big">{soil ? formatPercent(soil.percent, 1) : '—'}</span>
            <Chip tone={soil?.state === 'dry' ? 'warn' : soil?.state === 'unavailable' ? 'neutral' : 'live'}>
              {soilLabel(soil?.state)}
            </Chip>
          </div>
          <dl className="mini-kv">
            <div>
              <dt>Raw</dt>
              <dd>{soil?.raw ?? '—'}</dd>
            </div>
            <div>
              <dt>Calibrated</dt>
              <dd>{soil ? (soil.calibrated ? 'yes' : 'no') : '—'}</dd>
            </div>
            <div>
              <dt>Age</dt>
              <dd>{formatAge(soil?.age_ms)}</dd>
            </div>
          </dl>
          {soil?.fault && <p className="error-text">Fault: {soil.fault}</p>}
          <p className="hint">Calibrated relative value, never a laboratory volumetric measurement.</p>
        </Card>

        <Card kicker="Reservoir" title="Two wire probes">
          <div className={cx('reading-value', inactive && 'is-inactive')}>
            <span className="reading-big">{reservoirLabel(reservoir?.state)}</span>
            <Chip
              tone={
                reservoir?.state === 'available' ? 'live' : reservoir?.state === 'low' ? 'warn' : 'neutral'
              }
            >
              {formatMv(reservoir?.millivolts)}
            </Chip>
          </div>
          <dl className="mini-kv">
            <div>
              <dt>Conductive</dt>
              <dd>{reservoir?.conductive === null || reservoir?.conductive === undefined ? '—' : reservoir.conductive ? 'yes' : 'no'}</dd>
            </div>
            <div>
              <dt>Calibrated</dt>
              <dd>{reservoir ? (reservoir.calibrated ? 'yes' : 'no') : '—'}</dd>
            </div>
            <div>
              <dt>Age</dt>
              <dd>{formatAge(reservoir?.age_ms)}</dd>
            </div>
          </dl>
          {reservoir?.fault && <p className="error-text">Fault: {reservoir.fault}</p>}
          <p className="hint">Only “available” or “low”. No percentage, volume or capacity is reported.</p>
        </Card>

        <Card kicker="Light" title="LDR streetlight sensor">
          <div className={cx('reading-value', inactive && 'is-inactive')}>
            <span className="reading-big">
              {light && light.installed === false ? 'Not installed' : titleCase(light?.brightness ?? 'unknown')}
            </span>
            <Chip
              tone={
                light && light.installed === false
                  ? 'neutral'
                  : light?.brightness === 'dark'
                    ? 'warn'
                    : 'gold'
              }
            >
              {light && light.installed === false
                ? 'no sensor'
                : light?.raw !== null && light?.raw !== undefined
                  ? `raw ${light.raw}`
                  : 'no raw value'}
            </Chip>
          </div>
          <dl className="mini-kv">
            <div>
              <dt>Output</dt>
              <dd>{light?.output_type ?? '—'}</dd>
            </div>
            <div>
              <dt>Valid</dt>
              <dd>{light ? (light.valid ? 'yes' : 'no') : '—'}</dd>
            </div>
            <div>
              <dt>Age</dt>
              <dd>{formatAge(light?.age_ms)}</dd>
            </div>
          </dl>
          {light?.fault && <p className="error-text">Fault: {light.fault}</p>}
          <p className="hint">
            A stale light reading is shown as unknown, never as bright or dark. With no LDR
            installed the controller reports nothing — a floating pin is not a measurement.
          </p>
        </Card>
      </div>

      <Card kicker="Ultrasonic" title="Bin distances">
        <div className={cx('bin-reading-grid', inactive && 'is-inactive')}>
          {bins.length === 0 && <p className="hint">No bin readings in the current frame.</p>}
          {bins.map((bin) => (
            <div className="bin-reading" key={bin.id}>
              <div className="bin-reading-head">
                <strong>{titleCase(bin.id)}</strong>
                <Chip tone={bin.state === 'full' ? 'bad' : bin.state === 'unavailable' ? 'neutral' : 'live'}>
                  {binLabel(bin.state)}
                </Chip>
              </div>
              <p className="bin-reading-distance">{formatCm(bin.distance_cm)}</p>
              <p className="hint">
                estimated fill {bin.fill_pct_estimate === null ? 'unavailable' : formatPercent(bin.fill_pct_estimate, 0)} ·{' '}
                {formatAge(bin.age_ms)}
              </p>
              {bin.fault && <p className="error-text">{bin.fault}</p>}
            </div>
          ))}
        </div>
      </Card>

      <form className="config-form" onSubmit={(event) => void handleSubmit(event)}>
        <Card
          kicker="Configuration"
          title="Calibration and thresholds"
          actions={
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={!dirty || saving}
                onClick={() => saved && setDraft(clone(saved.config))}
              >
                Discard changes
              </button>
              <button
                type="submit"
                className="btn btn--primary btn--small"
                disabled={!dirty || saving || !draft}
                data-testid="save-calibration"
              >
                {saving ? 'Saving…' : 'Save configuration'}
              </button>
            </div>
          }
        >
          {!draft || !saved ? (
            <p className="hint">Reading the controller configuration…</p>
          ) : (
            <>
              {demo && (
                <p className="hint">
                  Demo mode: saves are applied to the simulator with <code>mode: demo</code>.
                </p>
              )}
              {simulator && (
                <p className="hint">
                  The source is the local simulator, so these settings calibrate simulated probes.
                </p>
              )}

              <fieldset className="config-section">
                <legend>Soil moisture — two raw endpoints</legend>
                <p className="hint">
                  Put the probe in dry soil, note the raw value, then in wet soil and note the raw
                  value. Either polarity works: the firmware maps one endpoint to 0% and the other
                  to 100% automatically.
                </p>
                <div className="field-grid">
                  <label className="field">
                    <span>Dry endpoint (raw)</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={4095}
                      step={1}
                      id="soil-dry"
                      value={draft.soil.dry_raw}
                      onChange={(event) =>
                        update((next) => {
                          next.soil.dry_raw = asNumber(event.target.value);
                          next.soil.calibrated = false;
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Wet endpoint (raw)</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={4095}
                      step={1}
                      id="soil-wet"
                      value={draft.soil.wet_raw}
                      onChange={(event) =>
                        update((next) => {
                          next.soil.wet_raw = asNumber(event.target.value);
                          next.soil.calibrated = false;
                        })
                      }
                    />
                  </label>
                </div>
                <p className="hint">
                  The controller requires the endpoints to differ by at least {draft.soil.min_span_raw || 400}{' '}
                  raw counts.
                </p>
                <label className="check-row" style={{ marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(draft.soil.calibrated)}
                    onChange={(event) =>
                      update((next) => {
                        next.soil.calibrated = event.target.checked;
                      })
                    }
                  />
                  <span>
                    <strong>I captured these readings from the real soil.</strong> Until this is
                    ticked, the controller reports <em>uncalibrated</em> and blocks irrigation.
                    Changing either endpoint clears the tick so it must be confirmed again.
                  </span>
                </label>
              </fieldset>

              <fieldset className="config-section">
                <legend>Reservoir — millivolt thresholds</legend>
                <p className="hint">
                  Measure the two probes in air (dry) and in water at the real spacing (wet). A
                  reading below the wet threshold means water is available; above the dry threshold
                  means low. The band between them is a deliberate dead zone.
                </p>
                <div className="field-grid">
                  <label className="field">
                    <span>Wet threshold (mV)</span>
                    <input
                      className="input"
                      type="number"
                      min={50}
                      max={3200}
                      step={1}
                      id="reservoir-wet"
                      value={draft.reservoir.wet_threshold_mv}
                      onChange={(event) =>
                        update((next) => {
                          next.reservoir.wet_threshold_mv = asNumber(event.target.value);
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Dry threshold (mV)</span>
                    <input
                      className="input"
                      type="number"
                      min={50}
                      max={3200}
                      step={1}
                      id="reservoir-dry"
                      value={draft.reservoir.dry_threshold_mv}
                      onChange={(event) =>
                        update((next) => {
                          next.reservoir.dry_threshold_mv = asNumber(event.target.value);
                        })
                      }
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="config-section">
                <legend>Bin distances</legend>
                <p className="hint">
                  Empty distance is measured with the bin empty; full distance is where the bin is
                  considered full. Fill is an estimated height, not a waste weight.
                </p>
                <div className="bin-config-grid">
                  {draft.bins.map((bin) => (
                    <div className="bin-config" key={bin.id}>
                      <p className="bin-config-title">{titleCase(bin.id)}</p>
                      <label className="field">
                        <span>Empty (cm)</span>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          step={0.5}
                          value={bin.empty_cm}
                          onChange={(event) =>
                            update((next) => {
                              const row = next.bins.find((entry) => entry.id === bin.id);
                              if (row) row.empty_cm = asNumber(event.target.value);
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Full (cm)</span>
                        <input
                          className="input"
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={bin.full_cm}
                          onChange={(event) =>
                            update((next) => {
                              const row = next.bins.find((entry) => entry.id === bin.id);
                              if (row) row.full_cm = asNumber(event.target.value);
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset className="config-section">
                <legend>Streetlight LDR and lamps</legend>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.light.installed)}
                    onChange={(event) =>
                      update((next) => {
                        next.light.installed = event.target.checked;
                      })
                    }
                  />
                  <span>
                    <strong>The streetlight lamps are wired.</strong> Until this is ticked the
                    four lamp outputs stay off. This does not affect the light sensor.
                  </span>
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.light.sensor_fitted)}
                    onChange={(event) =>
                      update((next) => {
                        next.light.sensor_fitted = event.target.checked;
                      })
                    }
                  />
                  <span>
                    <strong>The LDR is wired.</strong> Until this is ticked the controller
                    reports no light level — an unwired ADC pin reads noise that would otherwise
                    look like a real “dark”/“bright” observation.
                  </span>
                </label>
                <div className="field-grid">
                  <label className="field">
                    <span>Dark below (raw)</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={4095}
                      step={1}
                      id="ldr-dark"
                      value={draft.light.dark_threshold}
                      onChange={(event) =>
                        update((next) => {
                          next.light.dark_threshold = asNumber(event.target.value);
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Bright above (raw)</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={4095}
                      step={1}
                      id="ldr-bright"
                      value={draft.light.bright_threshold}
                      onChange={(event) =>
                        update((next) => {
                          next.light.bright_threshold = asNumber(event.target.value);
                        })
                      }
                    />
                  </label>
                </div>
                <p className="hint">
                  Auto mode uses hysteresis: it only changes after the reading is stable for{' '}
                  {Math.round((draft.light.stable_ms ?? 4000) / 1000)}s.
                </p>
              </fieldset>

              <p className="hint">
                {dirty
                  ? 'Your draft differs from the saved controller configuration.'
                  : `No unsaved changes. Controller revision ${saved.config_revision}.`}
              </p>
            </>
          )}
        </Card>
      </form>

      <p className="hint page-footnote">
        <IconInfo size={14} /> The controller validates everything again. A 409 means somebody else
        saved first; this page never overwrites blindly.
      </p>

      {!live && (
        <Notice tone="warn">
          <IconAlert size={15} /> The readings above are not live. Calibration values can still be
          edited, but the controller will not apply them until it answers.
        </Notice>
      )}
    </div>
  );
}

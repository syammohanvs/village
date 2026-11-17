import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconCamera,
  IconDroplet,
  IconLamp,
  IconMic,
  IconPlay,
  IconPump,
  IconStop,
  IconSun,
  IconWind,
} from '../components/Icons';
import { LanguagePicker } from '../components/LanguagePicker';
import { LightLevelSlider, StreetLampStrip } from '../components/StreetLamps';
import { Chip } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useCommands } from '../lib/commands';
import { reservoirLabel, soilLabel } from '../lib/explain';
import { cx, formatPercent } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useVillage } from '../lib/village';
import { VOICE_LANGUAGES, useVoiceUi, type VoiceLanguage } from '../lib/voiceUi';

type CardKey = 'plants' | 'lights';

// The panel "generates" only when current actually flows through the LED load.
// A red LED needs about 1.8 V before it conducts, so a dim panel honestly reads
// 0 mA — that is a true reading, not a fault.  The threshold sits far above the
// dark noise floor (~0.007 mW here) and far below any real light (a phone torch
// gives ~15 mW), so it cannot be flipped by ADC jitter.
const SOLAR_GENERATING_MW = 0.1;

function levelChip(text: string, tone: 'live' | 'warn' | 'bad' | 'neutral' | 'gold') {
  return <Chip tone={tone}>{text}</Chip>;
}

function stateLine(text: string, tone: 'good' | 'warn' | 'bad' | 'neutral' = 'neutral') {
  return <p className={cx('vcard-state', `vcard-state--${tone}`)}>{text}</p>;
}

export function OurVillage() {
  const { status, envelope, loading, error, reload, connected, demo } = useVillage();
  const { send } = useCommands();
  const { openPanel, language, setLanguage } = useVoiceUi();
  const navigate = useNavigate();

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ card: CardKey; text: string } | null>(null);

  const model = useApi(['waste-model-home'], () => api.wasteModelStatus(), { intervalMs: 30000 });

  const sensors = status?.sensors;
  const soil = sensors?.soil;
  const reservoir = sensors?.reservoir;
  const light = sensors?.light;
  const solar = sensors?.solar;
  const wind = sensors?.wind;
  const irrigation = status?.irrigation;
  const lights = status?.actuators?.streetlights;
  const waste = status?.actuators?.waste_indicator;

  // "Known" is a fact about the frame we hold, never about the hardware.
  const hasStatus = Boolean(status);
  const watering = irrigation?.state === 'pumping' || irrigation?.state === 'soaking';
  const pumpOn = irrigation?.state === 'pumping';
  const physicalDisabled = !connected && !demo;

  const pumpCommissioned =
    typeof status?.actuators?.pump?.commissioned === 'boolean'
      ? status.actuators.pump.commissioned
      : null;
  const lightMode: 'auto' | 'on' | 'off' | null =
    lights?.mode === 'auto'
      ? 'auto'
      : typeof lights?.commanded === 'boolean'
        ? lights.commanded ? 'on' : 'off'
        : null;
  // The lab's own reading of the slider: the firmware's metric, or raw turned
  // into one.  A frame that carries neither leaves the slider where it was.
  const lightMetric =
    typeof light?.metric === 'number'
      ? light.metric
      : typeof light?.raw === 'number'
        ? Math.max(0, 4095 - light.raw)
        : 1820;
  const lightWord = light?.installed === false
    ? 'No sensor'
    : light?.brightness === 'dark' ? 'Dark' : light?.brightness === 'bright' ? 'Bright' : 'Unknown';

  const soilPercent = soil?.calibrated && soil.percent !== null ? formatPercent(soil.percent, 0) : null;
  const soilWord = !hasStatus
    ? 'Status unknown'
    : soil?.calibrated
      ? soilLabel(soil.state)
      : soil?.state === 'uncalibrated'
        ? 'Not calibrated'
        : 'Status unknown';

  const tankWord = hasStatus ? reservoirLabel(reservoir?.state) : 'Status unknown';
  const tankTone = !hasStatus
    ? 'neutral'
    : reservoir?.state === 'available' ? 'live' : reservoir?.state === 'low' ? 'warn' : 'neutral';

  const solarVolts = hasStatus && solar?.millivolts != null ? (solar.millivolts / 1000).toFixed(2) : null;
  const solarCurrent = hasStatus && solar?.current_ma != null ? solar.current_ma.toFixed(2) : null;
  const solarPower = hasStatus && solar?.power_mw != null ? solar.power_mw.toFixed(1) : null;
  const solarGenerating = Boolean(solarVolts) && (solar?.power_mw ?? 0) >= SOLAR_GENERATING_MW;

  const windVolts = hasStatus && wind?.millivolts != null ? (wind.millivolts / 1000).toFixed(2) : null;
  const windFitted = wind?.installed ?? false;
  const windGenerating = Boolean(wind?.generating);

  const modelInstalled = model.data?.installed ?? model.data?.available ?? model.data?.present;
  const modelChip = model.error
    ? levelChip('Model unknown', 'neutral')
    : model.loading
      ? levelChip('Checking…', 'neutral')
      : modelInstalled
        ? levelChip('Camera ready', 'live')
        : levelChip('Model missing', 'warn');

  /** The demo's pump switch: hold it on or off regardless of the soil. */
  const [pumpManual, setPumpManual] = useState<'auto' | 'on' | 'off' | null>(null);
  const pumpMode: 'auto' | 'on' | 'off' =
    pumpManual ?? (status?.actuators?.pump?.manual === 'on'
      ? 'on'
      : status?.actuators?.pump?.manual === 'off'
        ? 'off'
        : 'auto');

  const setPumpMode = async (mode: 'auto' | 'on' | 'off') => {
    setPumpManual(mode);
    try {
      await api.demoScenario({ pump_manual: mode });
    } catch (cause) {
      setNotice({ card: 'plants', text: errorMessage(cause) });
    } finally {
      reload();
    }
  };

  /** The simulated room's light level, for exercising Auto mode without a torch. */
  const setAmbient = async (value: number) => {
    try {
      await api.demoScenario({ light_metric: value });
    } catch (cause) {
      setNotice({ card: 'lights', text: errorMessage(cause) });
    } finally {
      reload();
    }
  };

  const run = async (key: string, card: CardKey, type: string) => {
    setBusy(key);
    setNotice(null);
    try {
      const outcome = await send(type);
      if (outcome.status !== 'confirmed' && outcome.status !== 'duplicate') {
        setNotice({
          card,
          text: outcome.reason ?? 'The controller did not confirm the action.',
        });
      }
    } finally {
      setBusy(null);
      // Read the frame back rather than waiting up to two seconds for the poll:
      // the pump and the lamps changed because of this press, and the card
      // should say so at once.
      reload();
    }
  };

  // The firmware refuses these too; disabling here explains why instead of
  // letting a visitor press a button that can only be refused.
  const waterBlocked = !hasStatus && !demo
    ? 'Connect the board to check watering readiness.'
    : pumpCommissioned === false
      ? 'The pump is not commissioned, so watering is disabled.'
      : reservoir?.state === 'low'
        ? 'The tank water is low. Refill the reservoir before watering.'
        : reservoir?.state !== 'available'
          ? 'The tank reading is unavailable, so watering is disabled.'
          : soil?.state === 'wet' || soil?.state === 'adequate'
            ? 'The soil is already moist, so watering is not needed.'
            : soil?.calibrated === false
              ? 'The soil probe is not calibrated, so the controller will refuse to water.'
              : physicalDisabled
                ? 'The controller is offline. Actions are disabled.'
                : '';

  const startDisabled = busy !== null || watering || Boolean(waterBlocked);
  // Stop belongs to a run.  The user's rule (2026-11-16, twice): Stop is offered
  // only while the pump is actually on, so a card that says "watering is not
  // needed" does not also offer a button that looks like it would act.
  //
  // The trade-off is deliberate and worth knowing: the firmware writes the pump
  // gate low on every IRRIGATION_STOP even when idle, so this gives up a
  // convenient hard-kill for the case where the board's own state is wrong.  The
  // bench page (Setup → Test outputs) is where an output is forced by hand.
  const stopDisabled = busy !== null || !watering;

  return (
    <div className="page village-page village-page--minimal">
      <header className="village-simple-top">
        <button
          type="button"
          className="mic-button"
          onClick={openPanel}
          data-testid="start-voice"
          aria-label="Talk to the village"
          title="Talk to the village"
        >
          <IconMic size={28} />
        </button>
        <LanguagePicker
          className="village-simple-langs"
          options={VOICE_LANGUAGES.map((entry) => ({ code: entry.code, label: entry.label }))}
          value={language}
          onChange={(code) => setLanguage(code as VoiceLanguage)}
          label="Language"
          testId="invite-lang"
        />
      </header>

      {Boolean(error) && !envelope && (
        <p className="village-simple-note" role="alert">
          The village service is not answering.{' '}
          <button type="button" className="link-btn" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {!envelope && loading && (
        <p className="village-simple-note" role="status">Waiting for the first frame…</p>
      )}
      <div className="village-grid village-grid--minimal">
        <article className="vcard vcard--min" data-testid="card-plants">
          <header className="vcard-head">
            <span className="vcard-icon" aria-hidden="true"><IconDroplet size={19} /></span>
            <h2>Watering</h2>
            {levelChip(
              !hasStatus ? 'Status unknown' : watering ? 'Watering' : 'Idle',
              watering ? 'live' : 'neutral',
            )}
          </header>
          {stateLine(
            hasStatus
              ? soilPercent ? `${soilWord} · ${soilPercent}%` : soilWord
              : 'No soil reading yet',
            soil?.state === 'dry' ? 'warn' : 'neutral',
          )}
          <div className="vcard-actions">
            <button
              type="button"
              className="btn btn--primary"
              data-testid="water-plants"
              disabled={startDisabled}
              onClick={() => void run('water', 'plants', 'IRRIGATION_REQUEST')}
            >
              <IconPlay size={16} /> Water
            </button>
            <button
              type="button"
              className="btn btn--danger"
              data-testid="stop-watering"
              disabled={stopDisabled}
              title={
                watering
                  ? 'Stop the pump now.'
                  : 'Forces the pump off. Nothing is running at the moment.'
              }
              onClick={() => void run('stop', 'plants', 'IRRIGATION_STOP')}
            >
              <IconStop size={16} /> Stop
            </button>
          </div>
          {demo && (
            <div className="pump-manual" data-testid="pump-manual">
              <p className="pump-manual-label">
                Pump <span className="pump-manual-note">manual, simulation only</span>
              </p>
              <div className="segmented segmented--wide" role="group" aria-label="Pump mode">
                {(['auto', 'on', 'off'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`pump-${mode}`}
                    className={cx('segment', pumpMode === mode && 'is-active')}
                    aria-pressed={pumpMode === mode}
                    onClick={() => void setPumpMode(mode)}
                  >
                    {mode === 'auto' ? 'Auto' : mode === 'on' ? 'On' : 'Off'}
                  </button>
                ))}
              </div>
              <p className="hint">
                On holds the pump running whatever the soil says; Off holds it stopped. Auto gives
                it back to the rules.
              </p>
            </div>
          )}
          {waterBlocked && pumpMode !== 'on' && (
            <p className="vcard-note" data-testid="water-blocked">
              {waterBlocked}
              {demo && ' Use Reset in Setup → Simulation to put the demo back to dry soil.'}
            </p>
          )}
          {notice?.card === 'plants' && <p className="vcard-note vcard-note--warn">{notice.text}</p>}
        </article>

        <article className="vcard vcard--min" data-testid="card-tank">
          <header className="vcard-head">
            <span className="vcard-icon" aria-hidden="true"><IconPump size={19} /></span>
            <h2>Tank</h2>
            {levelChip(tankWord, tankTone)}
          </header>
          {stateLine(
            !hasStatus
              ? 'No reading'
              : reservoir?.state === 'available'
                ? 'Water above the minimum'
                : reservoir?.state === 'low'
                  ? 'Water at or below the minimum'
                  : 'No usable probe reading',
            reservoir?.state === 'available' ? 'good' : reservoir?.state === 'low' ? 'warn' : 'neutral',
          )}
          {/* What the controller is commanding the pump to do -- the same gate a
              spoken "water the plants" opens, so the card answers the question
              the Water button raises without opening another page. */}
          {hasStatus && (
            <p className="vcard-state" data-testid="pump-state" data-on={pumpOn ? 'true' : 'false'}>
              Pump <strong>{pumpOn ? 'on' : 'off'}</strong>
            </p>
          )}
        </article>

        <article className="vcard vcard--min" data-testid="card-lights">
          <header className="vcard-head">
            <span className="vcard-icon" aria-hidden="true"><IconLamp size={19} /></span>
            <h2>Lights</h2>
            {levelChip(hasStatus ? lightWord : 'Status unknown', light?.brightness === 'dark' ? 'gold' : 'neutral')}
          </header>
          <div className="segmented segmented--wide" role="group" aria-label="Streetlight mode">
            {(['auto', 'on', 'off'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-testid={`lights-${mode}`}
                className={cx('segment', lightMode === mode && 'is-active')}
                aria-pressed={lightMode === mode}
                disabled={physicalDisabled || busy !== null}
                onClick={() =>
                  void run(mode, 'lights', mode === 'auto' ? 'LIGHTS_AUTO' : mode === 'on' ? 'LIGHTS_ON' : 'LIGHTS_OFF')
                }
              >
                {mode === 'auto' ? 'Auto' : mode === 'on' ? 'On' : 'Off'}
              </button>
            ))}
          </div>
          {demo && (
            <div className="lamp-lab" data-testid="lamp-lab">
              <StreetLampStrip on={Boolean(lights?.commanded)} count={lights?.led_count ?? 5} />
              <LightLevelSlider
                metric={lightMetric}
                onChange={(value) => void setAmbient(value)}
                disabled={busy !== null}
              />
            </div>
          )}
          {notice?.card === 'lights' && <p className="vcard-note vcard-note--warn">{notice.text}</p>}
        </article>

        <article className="vcard vcard--min" data-testid="card-waste">
          <header className="vcard-head">
            <span className="vcard-icon" aria-hidden="true"><IconCamera size={19} /></span>
            <h2>Waste</h2>
            {modelChip}
          </header>
          {stateLine(
            !hasStatus
              ? 'No reading'
              : waste?.active && waste.category
                ? `Last item: ${waste.category}`
                : 'No item yet',
            waste?.active ? 'good' : 'neutral',
          )}
          <div className="vcard-actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => navigate('/waste')}
              data-testid="open-sort-waste"
              disabled={physicalDisabled}
              title={
                physicalDisabled
                  ? 'The controller is offline. Choose Simulation above to show the classifier without the board.'
                  : 'Open the waste camera.'
              }
            >
              <IconCamera size={16} /> Open camera
            </button>
          </div>
          {physicalDisabled && (
            <p className="vcard-note" data-testid="waste-offline-note">
              The controller is offline. Use <strong>Simulation</strong> in Setup to show the
              classifier without the board.
            </p>
          )}
        </article>
      </div>

      <article className="vcard vcard--min vcard--solar" data-testid="card-solar">
        <header className="vcard-head">
          <span className="vcard-icon" aria-hidden="true"><IconSun size={19} /></span>
          <h2>Solar</h2>
          {levelChip(
            !hasStatus
              ? 'Status unknown'
              : !solarVolts
                ? 'No reading'
                : solarGenerating
                  ? 'Generating'
                  : 'Not generating',
            solarGenerating ? 'live' : 'neutral',
          )}
        </header>
        {stateLine(
          solarVolts
            ? `${solarVolts} V · ${solarCurrent ?? '0.00'} mA · ${solarPower ?? '0.0'} mW`
            : 'No reading',
          'neutral',
        )}
      </article>

      <article className="vcard vcard--min vcard--solar" data-testid="card-wind">
        <header className="vcard-head">
          <span className="vcard-icon" aria-hidden="true"><IconWind size={19} /></span>
          <h2>Wind</h2>
          {levelChip(
            !hasStatus
              ? 'Status unknown'
              : !windFitted
                ? 'Not fitted'
                : windGenerating
                  ? 'Generating'
                  : 'Not generating',
            windGenerating ? 'live' : 'neutral',
          )}
        </header>
        {stateLine(windVolts ? `${windVolts} V` : 'No reading', 'neutral')}
        {windFitted ? (
          <p className="vcard-note">
            A generator's voltage alone; current needs a second input this board does not have
            free.
          </p>
        ) : null}
      </article>
    </div>
  );
}

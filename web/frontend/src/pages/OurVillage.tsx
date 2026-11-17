import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconCamera,
  IconDroplet,
  IconLamp,
  IconMic,
  IconPump,
  IconSun,
  IconWind,
} from '../components/Icons';
import { LanguagePicker } from '../components/LanguagePicker';
import { SimSlider } from '../components/SimSlider';
import { SolarPanel, Windmill } from '../components/SimPictures';
import { WasteSamples } from '../components/WasteSamples';
import { BRIGHT_THRESHOLD, DARK_THRESHOLD, StreetLampStrip } from '../components/StreetLamps';
import { Chip } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useCommands } from '../lib/commands';
import { reservoirLabel, soilLabel } from '../lib/explain';
import { cx, formatPercent } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useVillage } from '../lib/village';
import { VOICE_LANGUAGES, useVoiceUi, type VoiceLanguage } from '../lib/voiceUi';

type CardKey = 'plants' | 'lights' | 'tank' | 'solar' | 'wind' | 'waste';

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
  // What the last quick demonstration changed, said in words.
  const [presetNote, setPresetNote] = useState<string | null>(null);
  const [samplesOpen, setSamplesOpen] = useState(false);

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
  const pumpOn = irrigation?.state === 'pumping';
  const physicalDisabled = !connected && !demo;

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

  // Auto / On / Off, like the streetlights.  Auto is every rule; On and Off
  // are the operator's switch, watched only by the tank.
  const pumpMode: 'auto' | 'on' | 'off' =
    status?.actuators?.pump?.mode === 'on'
      ? 'on'
      : status?.actuators?.pump?.mode === 'off'
        ? 'off'
        : 'auto';

  // Why the lights are where they are, in the words the examples use.  In Auto
  // it is the sensor; in On/Off it is the switch, and saying so stops a visitor
  // thinking Auto is broken when their manual On holds the lamps on at noon.
  const lightWhy = !hasStatus
    ? 'Waiting for the first reading from the simulator.'
    : lights?.installed === false
      ? 'The streetlights are not fitted in this build.'
      : lightMode === 'on'
        ? 'Manual On selected → streetlights stay on.'
        : lightMode === 'off'
          ? 'Manual Off selected → streetlights stay off.'
          : light?.brightness === 'dark'
            ? 'It is dark and Auto is selected → streetlights on.'
            : light?.brightness === 'bright'
              ? 'It is bright and Auto is selected → streetlights off.'
              : 'The light reading is between the two thresholds, so the last decision holds.';

  // The same question for the pump.  The controller's own reason is used
  // wherever there is one, because it is the rule that actually decided.
  const pumpWhy = !hasStatus
    ? 'Waiting for the first reading from the simulator.'
    : pumpMode === 'off'
      ? 'Manual Off selected → pump off.'
      : pumpMode === 'on'
        ? pumpOn
          ? 'Manual On selected → the pump runs; only a low tank stops it.'
          : (reservoir?.state === 'low'
              ? 'Manual On cannot run the pump while the water is low.'
              : 'Manual On selected, but the pump is not running yet.')
        : (irrigation?.reason ?? 'Auto is following the soil and water readings.');

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

  /**
   * One simulated condition.  These go to the demo device only (`/demo/*`), so
   * nothing here can reach a pin on the board — the whole lab is on that side of
   * the line, presets included.
   */
  const setScenario = async (patch: Record<string, unknown>, card: CardKey) => {
    try {
      await api.demoScenario(patch);
    } catch (cause) {
      setNotice({ card, text: errorMessage(cause) });
    } finally {
      reload();
    }
  };

  const runPreset = async (preset: 'night' | 'dry' | 'low' | 'reset') => {
    setNotice(null);
    try {
      if (preset === 'reset') {
        await api.demoReset();
        setPresetNote('Demo reset: the village is back to its starting conditions.');
      } else if (preset === 'night') {
        await api.demoScenario({ light_metric: 1820, lights_mode: 'auto' });
        setPresetNote('Night-time: outside light set to dark, streetlights on Auto.');
      } else if (preset === 'dry') {
        await api.demoScenario({ soil_pct: 20, reservoir: 'available', pump_manual: 'auto' });
        setPresetNote('Dry soil: moisture below the dry threshold, water available, pump on Auto.');
      } else {
        await api.demoScenario({ soil_pct: 20, reservoir: 'low', pump_manual: 'auto' });
        setPresetNote('Low water: dry soil and a low tank on Auto — watering is blocked.');
      }
    } catch (cause) {
      setNotice({ card: 'plants', text: errorMessage(cause) });
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

  // What the controller will refuse, said before it happens.  The tank is the
  // one condition that stops the pump even on the manual switch, so it belongs
  // on the card; wet soil only means Auto has nothing to do.
  const pumpNote = !hasStatus && !demo
    ? 'Connect the board to check watering readiness.'
    : reservoir?.state === 'low'
      ? `The tank water is low. Refill the reservoir — the pump will not run, on Auto or by hand.${
          demo ? ' Use Reset in Setup → Simulation to refill the demo tank.' : ''
        }`
      : reservoir?.state !== 'available'
        ? // Nothing to say: a probe that is not fitted cannot report, the
          // switch works anyway, and the Rain Water Tank card already shows
          // "not calibrated".  Only a tank that IS low is worth a sentence.
          ''
        : physicalDisabled
          ? 'The controller is offline. Actions are disabled.'
          : '';



  return (
    <div className="page village-page village-page--minimal">
      <header className="village-simple-top">
        <button
          type="button"
          className="mic-button"
          onClick={openPanel}
          data-testid="start-voice"
          aria-label="Talk to Sara"
          title="Talk to Sara"
        >
          <span className="mic-button-icon" aria-hidden="true">
            <IconMic size={26} />
          </span>
          <span className="mic-button-label">Talk to Sara</span>
        </button>
        <p className="village-simple-lang-label">Speak to Sara in…</p>
        <LanguagePicker
          className="village-simple-langs"
          options={VOICE_LANGUAGES.map((entry) => ({ code: entry.code, label: entry.label }))}
          value={language}
          onChange={(code) => setLanguage(code as VoiceLanguage)}
          label="Speak to Sara in"
          testId="invite-lang"
        />
      </header>

      {demo && (
        <div className="sim-banner" data-testid="sim-intro">
          <p className="sim-banner-title">
            Try changing the light, soil and water conditions. See how the village responds.
          </p>
          <p className="sim-banner-note">
            Simulation — physical model is not controlled. Nothing on this page moves the board,
            and these readings are invented.
          </p>
        </div>
      )}

      {demo && (
        <div className="sim-presets" data-testid="sim-presets">
          <p className="sim-presets-head">Quick demonstrations</p>
          <div className="sim-presets-row">
            <button type="button" className="btn btn--ghost" data-testid="preset-night" onClick={() => void runPreset('night')}>
              Night-time
            </button>
            <button type="button" className="btn btn--ghost" data-testid="preset-dry" onClick={() => void runPreset('dry')}>
              Dry soil
            </button>
            <button type="button" className="btn btn--ghost" data-testid="preset-low" onClick={() => void runPreset('low')}>
              Low water
            </button>
            <button type="button" className="btn btn--gold" data-testid="preset-reset" onClick={() => void runPreset('reset')}>
              Reset demo
            </button>
          </div>
          {presetNote && (
            <p className="sim-presets-note" data-testid="preset-note">
              {presetNote}
            </p>
          )}
        </div>
      )}

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
      <div className="village-rows">
        <article className="vcard vcard--min vcard--row" data-testid="card-plants">
          <header className="vcard-head">
            <span className="vcard-icon" aria-hidden="true"><IconDroplet size={19} /></span>
            <h2>Watering</h2>
            <span data-testid="pump-state" data-on={pumpOn ? 'true' : 'false'}>
              {levelChip(
                !hasStatus ? 'Status unknown' : pumpOn ? 'Pump running' : 'Pump off',
                pumpOn ? 'live' : 'neutral',
              )}
            </span>
          </header>
          {/* The chip beside the name says whether a watering session is
              running; this line is the SOIL's own reading.  It used to read
              just "Not calibrated", which sat next to the "Idle" chip looking
              like a second answer to the same question (asked 2026-11-17). */}
          {stateLine(
            hasStatus
              ? soilPercent
                ? // soilPercent is already formatted WITH its "%" — the first
                  // version appended another one, so a calibrated probe read
                  // "Dry · 28%%" and no test had ever seen it (2026-11-17).
                  `Soil: ${soilWord.toLowerCase()} · ${soilPercent}`
                : `Soil: ${soilWord.toLowerCase()}`
              : 'No soil reading yet',
            soil?.state === 'dry' ? 'warn' : 'neutral',
          )}
          <div className="pump-manual" data-testid="pump-manual">
              <p className="pump-manual-label">Pump</p>
              <div className="segmented segmented--wide" role="group" aria-label="Pump mode">
                {(['auto', 'on', 'off'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`pump-${mode}`}
                    className={cx('segment', pumpMode === mode && 'is-active')}
                    aria-pressed={pumpMode === mode}
                    disabled={physicalDisabled || busy !== null}
                    onClick={() =>
                      void run(
                        `pump-${mode}`,
                        'plants',
                        mode === 'auto' ? 'PUMP_AUTO' : mode === 'on' ? 'PUMP_ON' : 'PUMP_OFF',
                      )
                    }
                  >
                    {mode === 'auto' ? 'Auto' : mode === 'on' ? 'On' : 'Off'}
                  </button>
                ))}
              </div>
            </div>
          {pumpNote && (
            <p className="vcard-note" data-testid="pump-note">
              {pumpNote}
            </p>
          )}
          {demo && (
            <div className="sim-block" data-testid="sim-watering">
              <SimSlider
                label="Soil moisture indication"
                testId="sim-soil"
                value={typeof soil?.percent === 'number' ? soil.percent : 0}
                lowLabel="Dry"
                highLabel="Wet"
                valueText={`${soilWord} · ${soilPercent ?? '—'}`}
                disabled={busy !== null}
                onChange={(next) => void setScenario({ soil_pct: next }, 'plants')}
                hint="An indication from the simulated probe, not a measured amount of water in the soil."
              />
              <p className="sim-why" data-testid="water-why">
                {pumpWhy}
              </p>
              <p className="sim-why-note">
                The pump follows the same thresholds, pulses and limits as the real controller.
              </p>
            </div>
          )}
          {notice?.card === 'plants' && <p className="vcard-note vcard-note--warn">{notice.text}</p>}
        </article>

        <article className="vcard vcard--min vcard--row" data-testid="card-tank">
          <header className="vcard-head">
            <span className="vcard-icon" aria-hidden="true"><IconPump size={19} /></span>
            <h2>Rain Water Tank</h2>
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
          {demo && (
            <div className="sim-block" data-testid="sim-tank">
              <div className="sim-choice" role="group" aria-label="Simulated water in the tank">
                <button
                  type="button"
                  className={cx('sim-choice-btn', reservoir?.state === 'available' && 'is-on')}
                  aria-pressed={reservoir?.state === 'available'}
                  data-testid="sim-tank-available"
                  onClick={() => void setScenario({ reservoir: 'available' }, 'tank')}
                >
                  Water available
                </button>
                <button
                  type="button"
                  className={cx('sim-choice-btn', reservoir?.state === 'low' && 'is-on')}
                  aria-pressed={reservoir?.state === 'low'}
                  data-testid="sim-tank-low"
                  onClick={() => void setScenario({ reservoir: 'low' }, 'tank')}
                >
                  Low water
                </button>
              </div>
              <p className="sim-hint">
                Two wires in the tank: this is the whole choice the real detector can make. The pump
                and any reason it is blocked are shown in the Watering row.
              </p>
            </div>
          )}
          {notice?.card === 'tank' && <p className="vcard-note vcard-note--warn">{notice.text}</p>}
        </article>

        <article className="vcard vcard--min vcard--row" data-testid="card-lights">
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
            <div className="sim-block sim-block--lights" data-testid="lamp-lab">
              <div className="sim-readings">
                <span data-testid="outside-reading">
                  Outside: <strong>{lightWord}</strong>
                </span>
                <span data-testid="streetlights-reading">
                  Streetlights: <strong>{lights?.commanded ? 'On' : 'Off'}</strong>
                </span>
              </div>
              <div className="sim-lamps">
                <span className="sim-lamps-label">Streetlights</span>
                <StreetLampStrip on={Boolean(lights?.commanded)} count={lights?.led_count ?? 5} />
              </div>
              <SimSlider
                label="Outside light"
                testId="sim-outside"
                value={lightMetric}
                min={0}
                max={4095}
                lowLabel="Dark"
                highLabel="Bright"
                valueText={lightWord}
                describe={(value) =>
                  value < DARK_THRESHOLD ? 'Dark' : value > BRIGHT_THRESHOLD ? 'Bright' : 'In between'
                }
                disabled={busy !== null}
                onChange={(value) => void setAmbient(value)}
              />
              <p className="sim-why" data-testid="lights-why">
                {lightWhy}
              </p>
            </div>
          )}
          {notice?.card === 'lights' && <p className="vcard-note vcard-note--warn">{notice.text}</p>}
        </article>

        <article className="vcard vcard--min vcard--row" data-testid="card-waste">
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
              <IconCamera size={16} /> Identify waste
            </button>
            {demo && (
              <button
                type="button"
                className="btn btn--ghost"
                data-testid="try-sample"
                onClick={() => setSamplesOpen(true)}
                title="Five preset items, showing what the village tells you. Not a camera result."
              >
                Try a sample
              </button>
            )}
          </div>
          {demo && (
            <p className="sim-hint" data-testid="sample-note">
              A sample shows the guidance for one preset item; <strong>Identify waste</strong> is the
              real camera classifier.
            </p>
          )}
          {physicalDisabled && (
            <p className="vcard-note" data-testid="waste-offline-note">
              The controller is offline. Use <strong>Simulation</strong> in Setup to show the
              classifier without the board.
            </p>
          )}
        </article>
      </div>

      <article className="vcard vcard--min vcard--solar vcard--row" data-testid="card-solar">
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
        {demo && (
          <div className="sim-block sim-block--solar" data-testid="sim-solar">
            <SolarPanel light={solar?.light ?? 0.55} />
            <SimSlider
              label="Light on solar panel"
              testId="sim-panel-light"
              value={(solar?.light ?? 0.55) * 100}
              lowLabel="Low light"
              highLabel="Strong light"
              valueText={`${Math.round((solar?.light ?? 0.55) * 100)}%`}
              disabled={busy !== null}
              onChange={(next) => void setScenario({ solar_light: next / 100 }, 'solar')}
              hint="Simulated values from the panel's own circuit — volts, the current through the 330 Ω resistor, and power = volts × milliamps. Not a measurement of the real panel."
            />
          </div>
        )}
      </article>

      <article className="vcard vcard--min vcard--solar vcard--row" data-testid="card-wind">
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
            Simulated voltage; power is not measured.
          </p>
        ) : null}
        {demo && (
          <div className="sim-block sim-block--wind" data-testid="sim-wind">
            <Windmill speed={wind?.speed ?? 0.6} />
            <SimSlider
              label="Windmill speed"
              testId="sim-wind-speed"
              value={(wind?.speed ?? 0.6) * 100}
              lowLabel="Still"
              highLabel="Fast"
              valueText={`${Math.round((wind?.speed ?? 0.6) * 100)}%`}
              disabled={busy !== null}
              onChange={(next) => void setScenario({ wind_speed: next / 100 }, 'wind')}
              hint="Simulated voltage; power is not measured — the board has no second input for current."
            />
          </div>
        )}
      </article>
      {samplesOpen && <WasteSamples onClose={() => setSamplesOpen(false)} />}
    </div>
  );
}

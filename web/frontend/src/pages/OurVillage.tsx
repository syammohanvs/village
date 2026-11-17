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
import { cx, formatPercent } from '../lib/format';
import { useT } from '../lib/i18n';
import { useApi } from '../lib/useApi';
import { useVillage } from '../lib/village';
import { VOICE_LANGUAGES, useVoiceUi, type VoiceLanguage } from '../lib/voiceUi';
import type { MessageKey } from '../lib/messages';

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

/** The soil state as a word, as a translation key. */
function soilWordKey(state: string | undefined): MessageKey {
  switch (state) {
    case 'dry':
      return 'soil.dry';
    case 'adequate':
      return 'soil.adequate';
    case 'wet':
      return 'soil.wet';
    case 'uncalibrated':
      return 'soil.uncalibrated';
    default:
      return 'soil.unavailable';
  }
}

/** The tank state as a word, as a translation key. */
function tankWordKey(state: string | undefined): MessageKey {
  switch (state) {
    case 'available':
      return 'tank.available';
    case 'low':
      return 'tank.low';
    case 'uncalibrated':
      return 'tank.uncalibrated';
    default:
      return 'tank.unknown';
  }
}

export function OurVillage() {
  const { status, envelope, loading, error, reload, connected, demo } = useVillage();
  const { send } = useCommands();
  const { openPanel, language, setLanguage } = useVoiceUi();
  const navigate = useNavigate();
  const t = useT();

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
    ? t('chip.noSensor')
    : light?.brightness === 'dark' ? t('chip.dark')
      : light?.brightness === 'bright' ? t('chip.bright') : t('chip.unknown');

  const soilPercent = soil?.calibrated && soil.percent !== null ? formatPercent(soil.percent, 0) : null;
  const soilWord = !hasStatus
    ? t('chip.statusUnknown')
    : soil?.calibrated
      ? t(soilWordKey(soil.state))
      : soil?.state === 'uncalibrated'
        ? t('soil.uncalibrated')
        : t('chip.statusUnknown');

  const tankWord = hasStatus ? t(tankWordKey(reservoir?.state)) : t('chip.statusUnknown');
  const tankTone = !hasStatus
    ? 'neutral'
    : reservoir?.state === 'available' ? 'live' : reservoir?.state === 'low' ? 'warn' : 'neutral';

  const solarVolts = hasStatus && solar?.millivolts != null ? (solar.millivolts / 1000).toFixed(2) : null;
  const solarCurrent = hasStatus && solar?.current_ma != null ? solar.current_ma.toFixed(2) : null;
  const solarPower = hasStatus && solar?.power_mw != null ? solar.power_mw.toFixed(1) : null;
  const solarGenerating = Boolean(solarVolts) && (solar?.power_mw ?? 0) >= SOLAR_GENERATING_MW;

  const windVolts = hasStatus && wind?.millivolts != null ? (wind.millivolts / 1000).toFixed(2) : null;

  // What the two pictures follow.  In Simulation the slider's own value is in
  // the frame; in Live the picture follows the measured volts, through the same
  // curve the simulator draws (150 mV dark … 4000 mV strong).  A dark panel
  // therefore shows an unlit LED rather than a decorative glow.
  const solarLightLevel = (() => {
    if (!hasStatus) return 0;
    if (typeof solar?.light === 'number') return Math.max(0, Math.min(1, solar.light));
    const mv = solar?.millivolts ?? 0;
    return Math.max(0, Math.min(1, (mv - 150) / 3850));
  })();
  const windSpeedLevel = (() => {
    if (!hasStatus) return 0;
    if (typeof wind?.speed === 'number') return Math.max(0, Math.min(1, wind.speed));
    if (!wind?.installed) return 0;
    return Math.max(0, Math.min(1, (wind?.millivolts ?? 0) / 2600));
  })();
  const windFitted = wind?.installed ?? false;
  const windGenerating = Boolean(wind?.generating);

  const modelInstalled = model.data?.installed ?? model.data?.available ?? model.data?.present;
  const modelChip = model.error
    ? levelChip(t('chip.modelUnknown'), 'neutral')
    : model.loading
      ? levelChip(t('chip.checking'), 'neutral')
      : modelInstalled
        ? levelChip(t('chip.cameraReady'), 'live')
        : levelChip(t('chip.modelMissing'), 'warn');

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
    ? t('light.whyWaiting')
    : lights?.installed === false
      ? t('light.whyNotFitted')
      : lightMode === 'on'
        ? t('light.whyManualOn')
        : lightMode === 'off'
          ? t('light.whyManualOff')
          : light?.brightness === 'dark'
            ? t('light.whyDark')
            : light?.brightness === 'bright'
              ? t('light.whyBright')
              : t('light.whyBetween');

  // The same question for the pump.  The controller's own reason is used
  // wherever there is one, because it is the rule that actually decided — but
  // that sentence is written by the firmware in English, so it is only used in
  // English.  In Hindi and Malayalam the panel says the same rule in the
  // visitor's language instead (`pump.whyAuto`).
  const pumpReason = irrigation?.reason;
  const pumpWhy = !hasStatus
    ? t('pump.whyWaiting')
    : pumpMode === 'off'
      ? t('pump.whyManualOff')
      : pumpMode === 'on'
        ? pumpOn
          ? t('pump.whyManualOnRunning')
          : (reservoir?.state === 'low'
              ? t('pump.whyManualOnLow')
              : t('pump.whyManualOnNotRunning'))
        : (language === 'en' && pumpReason ? pumpReason : t('pump.whyAuto'));

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
        setPresetNote(t('preset.noteReset'));
      } else if (preset === 'night') {
        await api.demoScenario({ light_metric: 1820, lights_mode: 'auto' });
        setPresetNote(t('preset.noteNight'));
      } else if (preset === 'dry') {
        await api.demoScenario({ soil_pct: 20, reservoir: 'available', pump_manual: 'auto' });
        setPresetNote(t('preset.noteDry'));
      } else {
        await api.demoScenario({ soil_pct: 20, reservoir: 'low', pump_manual: 'auto' });
        setPresetNote(t('preset.noteLow'));
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
          text: outcome.reason ?? t('page.notConfirmed'),
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
    ? t('pump.connectBoard')
    : reservoir?.state === 'low'
      ? (demo ? t('pump.lowTankWithReset') : t('pump.lowTank'))
      : reservoir?.state !== 'available'
        ? // Nothing to say: a probe that is not fitted cannot report, the
          // switch works anyway, and the Rain Water Tank card already shows
          // "not calibrated".  Only a tank that IS low is worth a sentence.
          ''
        : physicalDisabled
          ? t('pump.offline')
          : '';

  return (
    <div className="page village-page village-page--minimal">
      <header className="village-simple-top">
        <button
          type="button"
          className="mic-button"
          onClick={openPanel}
          data-testid="start-voice"
          aria-label={t('page.talkToSara')}
          title={t('page.talkToSara')}
        >
          <span className="mic-button-icon" aria-hidden="true">
            <IconMic size={26} />
          </span>
          <span className="mic-button-label">{t('page.talkToSara')}</span>
        </button>
        <p className="village-simple-lang-label" title={t('page.languageHint')}>
          {t('page.language')}
        </p>
        <LanguagePicker
          className="village-simple-langs"
          options={VOICE_LANGUAGES.map((entry) => ({ code: entry.code, label: entry.label }))}
          value={language}
          onChange={(code) => setLanguage(code as VoiceLanguage)}
          label={t('page.language')}
          testId="invite-lang"
        />
      </header>

      {demo && (
        <div className="sim-banner" data-testid="sim-intro">
          <p className="sim-banner-title">{t('page.simIntroTitle')}</p>
          <p className="sim-banner-note">{t('page.simIntroNote')}</p>
        </div>
      )}

      {demo && (
        <div className="sim-presets" data-testid="sim-presets">
          <p className="sim-presets-head">{t('page.presets')}</p>
          <div className="sim-presets-row">
            <button type="button" className="btn btn--ghost" data-testid="preset-night" onClick={() => void runPreset('night')}>
              {t('preset.night')}
            </button>
            <button type="button" className="btn btn--ghost" data-testid="preset-dry" onClick={() => void runPreset('dry')}>
              {t('preset.dry')}
            </button>
            <button type="button" className="btn btn--ghost" data-testid="preset-low" onClick={() => void runPreset('low')}>
              {t('preset.low')}
            </button>
            <button type="button" className="btn btn--gold" data-testid="preset-reset" onClick={() => void runPreset('reset')}>
              {t('preset.reset')}
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
          {t('page.serviceDown')}{' '}
          <button type="button" className="link-btn" onClick={reload}>
            {t('page.tryAgain')}
          </button>
        </p>
      )}
      {!envelope && loading && (
        <p className="village-simple-note" role="status">{t('page.waiting')}</p>
      )}
      <div className="village-rows">
        <article className="vcard vcard--min vcard--row" data-testid="card-plants">
          <header className="vcard-head">
            <span className="vcard-icon" aria-hidden="true"><IconDroplet size={19} /></span>
            <h2>{t('card.watering')}</h2>
            <span data-testid="pump-state" data-on={pumpOn ? 'true' : 'false'}>
              {levelChip(
                !hasStatus ? t('chip.statusUnknown') : pumpOn ? t('chip.pumpRunning') : t('chip.pumpOff'),
                pumpOn ? 'live' : 'neutral',
              )}
            </span>
          </header>
          {/* The chip beside the name says whether a watering session is
              running; this line is the SOIL's own reading. */}
          {stateLine(
            hasStatus
              ? soilPercent
                ? // soilPercent is already formatted WITH its "%".
                  t('page.soilWithValue', { state: soilWord, percent: soilPercent })
                : t('page.soilNoValue', { state: soilWord })
              : t('page.noSoilReading'),
            soil?.state === 'dry' ? 'warn' : 'neutral',
          )}
          <div className="pump-manual" data-testid="pump-manual">
            <p className="pump-manual-label">{t('sim.pump')}</p>
            <div className="segmented segmented--wide" role="group" aria-label={t('sim.pumpMode')}>
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
                  {mode === 'auto' ? t('sim.auto') : mode === 'on' ? t('sim.on') : t('sim.off')}
                </button>
              ))}
            </div>
          </div>
          {pumpNote && (
            <p className="vcard-note" data-testid="pump-note">
              {pumpNote}
            </p>
          )}
          {/* The sentence comes first in both modes: it is the rule that
              decided, and in Live it is the controller's own reason.  Only the
              slider is the lab's. */}
          <p className="sim-why sim-why--always" data-testid="water-why">
            {pumpWhy}
          </p>
          {demo && (
            <div className="sim-block" data-testid="sim-watering">
              <SimSlider
                label={t('sim.soilLabel')}
                testId="sim-soil"
                value={typeof soil?.percent === 'number' ? soil.percent : 0}
                lowLabel={t('sim.dry')}
                highLabel={t('sim.wet')}
                valueText={`${soilWord} · ${soilPercent ?? '—'}`}
                disabled={busy !== null}
                onChange={(next) => void setScenario({ soil_pct: next }, 'plants')}
                hint={t('sim.soilHint')}
              />
              <p className="sim-why-note">{t('sim.pumpThresholds')}</p>
            </div>
          )}
          {notice?.card === 'plants' && <p className="vcard-note vcard-note--warn">{notice.text}</p>}
        </article>

        <article className="vcard vcard--min vcard--row" data-testid="card-tank">
          <header className="vcard-head">
            <span className="vcard-icon" aria-hidden="true"><IconPump size={19} /></span>
            <h2>{t('card.tank')}</h2>
            {levelChip(tankWord, tankTone)}
          </header>
          {stateLine(
            !hasStatus
              ? t('page.noReading')
              : reservoir?.state === 'available'
                ? t('tank.lineAvailable')
                : reservoir?.state === 'low'
                  ? t('tank.lineLow')
                  : t('tank.lineUnusable'),
            reservoir?.state === 'available' ? 'good' : reservoir?.state === 'low' ? 'warn' : 'neutral',
          )}
          <p className="sim-hint sim-hint--always" data-testid="tank-note">
            {t('tank.hint')}
          </p>
          {demo && (
            <div className="sim-block" data-testid="sim-tank">
              <div className="sim-choice" role="group" aria-label={t('tank.simGroup')}>
                <button
                  type="button"
                  className={cx('sim-choice-btn', reservoir?.state === 'available' && 'is-on')}
                  aria-pressed={reservoir?.state === 'available'}
                  data-testid="sim-tank-available"
                  onClick={() => void setScenario({ reservoir: 'available' }, 'tank')}
                >
                  {t('tank.waterAvailable')}
                </button>
                <button
                  type="button"
                  className={cx('sim-choice-btn', reservoir?.state === 'low' && 'is-on')}
                  aria-pressed={reservoir?.state === 'low'}
                  data-testid="sim-tank-low"
                  onClick={() => void setScenario({ reservoir: 'low' }, 'tank')}
                >
                  {t('tank.waterLow')}
                </button>
              </div>
            </div>
          )}
          {notice?.card === 'tank' && <p className="vcard-note vcard-note--warn">{notice.text}</p>}
        </article>

        <article className="vcard vcard--min vcard--row" data-testid="card-lights">
          <header className="vcard-head">
            <span className="vcard-icon" aria-hidden="true"><IconLamp size={19} /></span>
            <h2>{t('card.lights')}</h2>
            {levelChip(hasStatus ? lightWord : t('chip.statusUnknown'), light?.brightness === 'dark' ? 'gold' : 'neutral')}
          </header>
          <div className="segmented segmented--wide" role="group" aria-label={t('sim.streetlightMode')}>
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
                {mode === 'auto' ? t('sim.auto') : mode === 'on' ? t('sim.on') : t('sim.off')}
              </button>
            ))}
          </div>
          <div className="sim-block sim-block--lights" data-testid="lights-detail">
            <div className="sim-readings">
              <span data-testid="outside-reading">
                {t('sim.outside')}: <strong>{lightWord}</strong>
              </span>
              <span data-testid="streetlights-reading">
                {t('sim.streetlights')}: <strong>{lights?.commanded ? t('sim.on') : t('sim.off')}</strong>
              </span>
            </div>
            <div className="sim-lamps">
              <span className="sim-lamps-label">{t('sim.streetlights')}</span>
              <StreetLampStrip on={Boolean(lights?.commanded)} count={lights?.led_count ?? 5} />
            </div>
            {demo && (
              <SimSlider
                label={t('sim.outsideLight')}
                testId="sim-outside"
                value={lightMetric}
                min={0}
                max={4095}
                lowLabel={t('chip.dark')}
                highLabel={t('chip.bright')}
                valueText={lightWord}
                describe={(value) =>
                  value < DARK_THRESHOLD
                    ? t('chip.dark')
                    : value > BRIGHT_THRESHOLD
                      ? t('chip.bright')
                      : t('sim.inBetween')
                }
                disabled={busy !== null}
                onChange={(value) => void setAmbient(value)}
              />
            )}
            <p className="sim-why" data-testid="lights-why">
              {lightWhy}
            </p>
          </div>
          {notice?.card === 'lights' && <p className="vcard-note vcard-note--warn">{notice.text}</p>}
        </article>

        <article className="vcard vcard--min vcard--row" data-testid="card-waste">
          <header className="vcard-head">
            <span className="vcard-icon" aria-hidden="true"><IconCamera size={19} /></span>
            <h2>{t('card.waste')}</h2>
            {modelChip}
          </header>
          {stateLine(
            !hasStatus
              ? t('page.noReading')
              : waste?.active && waste.category
                ? t('waste.lastItem', { item: waste.category })
                : t('waste.noItem'),
            waste?.active ? 'good' : 'neutral',
          )}
          <div className="vcard-actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => navigate('/waste')}
              data-testid="open-sort-waste"
              disabled={physicalDisabled}
              title={physicalDisabled ? t('waste.identifyOfflineTitle') : t('waste.identifyTitle')}
            >
              <IconCamera size={16} /> {t('waste.identify')}
            </button>
            {demo && (
              <button
                type="button"
                className="btn btn--ghost"
                data-testid="try-sample"
                onClick={() => setSamplesOpen(true)}
                title={t('waste.trySampleTitle')}
              >
                {t('waste.trySample')}
              </button>
            )}
          </div>
          {demo && (
            <p className="sim-hint" data-testid="sample-note">
              {t('waste.sampleNote')}
            </p>
          )}
          {physicalDisabled && (
            <p className="vcard-note" data-testid="waste-offline-note">
              {t('waste.offlineNote')}
            </p>
          )}
        </article>
      </div>

      <article className="vcard vcard--min vcard--solar vcard--row" data-testid="card-solar">
        <header className="vcard-head">
          <span className="vcard-icon" aria-hidden="true"><IconSun size={19} /></span>
          <h2>{t('card.solar')}</h2>
          {levelChip(
            !hasStatus
              ? t('chip.statusUnknown')
              : !solarVolts
                ? t('page.noReading')
                : solarGenerating
                  ? t('chip.generating')
                  : t('chip.notGenerating'),
            solarGenerating ? 'live' : 'neutral',
          )}
        </header>
        {stateLine(
          solarVolts
            ? `${solarVolts} V · ${solarCurrent ?? '0.00'} mA · ${solarPower ?? '0.0'} mW`
            : t('page.noReading'),
          'neutral',
        )}
        {/* The picture is worth having in both modes: in Simulation it follows
            the slider, and in Live it follows the volts the panel is actually
            producing — which is why a dark room shows an unlit LED. */}
        <div className="sim-block sim-block--solar" data-testid="sim-solar">
          <SolarPanel light={solarLightLevel} />
          {demo ? (
            <SimSlider
              label={t('sim.panelLight')}
              testId="sim-panel-light"
              value={solarLightLevel * 100}
              lowLabel={t('sim.lowLight')}
              highLabel={t('sim.strongLight')}
              valueText={`${Math.round(solarLightLevel * 100)}%`}
              disabled={busy !== null}
              onChange={(next) => void setScenario({ solar_light: next / 100 }, 'solar')}
              hint={t('sim.solarHint')}
            />
          ) : (
            <p className="sim-hint sim-hint--live" data-testid="solar-live-note">
              {t('solar.liveHint')}
            </p>
          )}
        </div>
      </article>

      <article className="vcard vcard--min vcard--solar vcard--row" data-testid="card-wind">
        <header className="vcard-head">
          <span className="vcard-icon" aria-hidden="true"><IconWind size={19} /></span>
          <h2>{t('card.wind')}</h2>
          {levelChip(
            !hasStatus
              ? t('chip.statusUnknown')
              : !windFitted
                ? t('chip.notFitted')
                : windGenerating
                  ? t('chip.generating')
                  : t('chip.notGenerating'),
            windGenerating ? 'live' : 'neutral',
          )}
        </header>
        {stateLine(windVolts ? `${windVolts} V` : t('page.noReading'), 'neutral')}
        {windFitted || demo ? (
          <p className="vcard-note">
            {demo ? t('wind.simulatedLine') : t('wind.measuredLine')}
          </p>
        ) : null}
        {/* The windmill turns in Simulation, and in Live it turns as fast as the
            volts allow — or stands still when no turbine is wired, which is this
            board's state. */}
        <div className="sim-block sim-block--wind" data-testid="sim-wind">
          <Windmill speed={windSpeedLevel} fitted={demo || windFitted} />
          {demo ? (
            <SimSlider
              label={t('sim.windSpeed')}
              testId="sim-wind-speed"
              value={windSpeedLevel * 100}
              lowLabel={t('sim.still')}
              highLabel={t('sim.fast')}
              valueText={`${Math.round(windSpeedLevel * 100)}%`}
              disabled={busy !== null}
              onChange={(next) => void setScenario({ wind_speed: next / 100 }, 'wind')}
              hint={t('sim.windHint')}
            />
          ) : (
            !windFitted && (
              <p className="sim-hint sim-hint--live" data-testid="wind-live-note">
                {t('wind.noTurbine', { volts: windVolts ?? '0.00' })}
              </p>
            )
          )}
        </div>
      </article>
      {samplesOpen && <WasteSamples onClose={() => setSamplesOpen(false)} />}
    </div>
  );
}

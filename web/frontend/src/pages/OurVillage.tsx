import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CommandResult } from '../components/CommandResult';
import {
  IconCamera,
  IconDroplet,
  IconInfo,
  IconLamp,
  IconMic,
  IconPlay,
  IconPump,
  IconStop,
} from '../components/Icons';
import { LanguagePicker } from '../components/LanguagePicker';
import { Card, Chip, Notice } from '../components/ui';
import { api } from '../lib/api';
import { useCommands } from '../lib/commands';
import { binLabel, lightModeLabel, reservoirLabel, soilLabel } from '../lib/explain';
import { cx, formatPercent } from '../lib/format';
import { openLia } from '../lib/liaUi';
import { friendlyEvent } from '../lib/timeline';
import { useApi } from '../lib/useApi';
import { useVillage } from '../lib/village';
import { VOICE_LANGUAGES, useVoiceUi, type VoiceLanguage } from '../lib/voiceUi';
import { VOICE_EXAMPLES, VOICE_LANGUAGE_NAMES } from '../lib/voiceExamples';
import type { BinReading } from '../types';

type CardKey = 'plants' | 'lights';

function levelChip(text: string, tone: 'live' | 'warn' | 'bad' | 'neutral' | 'gold') {
  return <Chip tone={tone}>{text}</Chip>;
}

function stateLine(text: string, tone: 'good' | 'warn' | 'bad' | 'neutral' = 'neutral') {
  return <p className={cx('vcard-state', `vcard-state--${tone}`)}>{text}</p>;
}

export function OurVillage() {
  const {
    status,
    envelope,
    loading,
    error,
    reload,
    connected,
    demo,
    simulator,
  } = useVillage();
  const { send, entries } = useCommands();
  const { openPanel, language, setLanguage } = useVoiceUi();
  const navigate = useNavigate();

  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Partial<Record<CardKey, string>>>({});

  const model = useApi(['waste-model-home'], () => api.wasteModelStatus(), { intervalMs: 30000 });
  const events = useApi(['events-home'], () => api.events(12), { intervalMs: 6000 });

  const sensors = status?.sensors;
  const soil = sensors?.soil;
  const reservoir = sensors?.reservoir;
  const light = sensors?.light;
  const irrigation = status?.irrigation;
  const pump = status?.actuators?.pump;
  const lights = status?.actuators?.streetlights;
  const waste = status?.actuators?.waste_indicator;
  const bins = sensors?.bins ?? [];

  // "Known" is a fact about the frame we hold, not about the hardware.  A
  // missing frame must not be turned into "Idle", "Off" or "not commissioned".
  const hasStatus = Boolean(status);
  const watering = irrigation?.state === 'pumping' || irrigation?.state === 'soaking';
  const physicalDisabled = !connected && !demo;

  const pumpCommissioned = typeof pump?.commissioned === 'boolean' ? pump.commissioned : null;
  const lightWired = light?.installed !== false;
  const lightMode: 'auto' | 'on' | 'off' | null =
    lights?.mode === 'auto' ? 'auto' : typeof lights?.commanded === 'boolean' ? (lights.commanded ? 'on' : 'off') : null;
  const lightWord =
    light?.brightness === 'dark' ? 'Dark' : light?.brightness === 'bright' ? 'Bright' : 'Unknown';

  const soilPercent = soil?.calibrated && soil.percent !== null ? formatPercent(soil.percent, 0) : null;

  const rows = events.data?.events ?? events.data?.items ?? [];
  const latestRecognition = rows.find((row) => {
    const raw = `${row.kind ?? ''} ${row.type ?? ''} ${row.code ?? ''}`.toLowerCase();
    return raw.includes('recogn') || raw.includes('waste');
  });
  const recent = rows.slice(0, 3);
  const eventTime = (event: { ts?: string; at?: string; created_at?: string; timestamp?: string }) =>
    event.ts ?? event.at ?? event.created_at ?? event.timestamp ?? '';

  const modelInstalled = model.data?.installed ?? model.data?.available ?? model.data?.present;
  const modelChip = model.error
    ? levelChip('Model status unknown', 'neutral')
    : model.loading
      ? levelChip('Checking model…', 'neutral')
      : modelInstalled
        ? levelChip('Model ready', 'live')
        : levelChip('Model missing', 'warn');

  const run = async (key: string, card: CardKey, type: string) => {
    setBusy(key);
    try {
      const outcome = await send(type);
      setFeedback((current) => ({ ...current, [card]: outcome.entry.id }));
    } finally {
      setBusy(null);
    }
  };

  // The firmware refuses these too; disabling here explains why instead of
  // letting a visitor press a button that can only be refused.  With no frame
  // at all, the honest answer is that readiness is unknown.
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
  const stopDisabled = busy !== null;

  const waterState = !hasStatus
    ? 'Watering status unknown.'
    : watering
      ? irrigation?.state === 'pumping'
        ? 'Watering now.'
        : 'Soaking — the pump is resting.'
      : irrigation?.state === 'cooldown'
        ? 'Cooling down after a watering session.'
        : 'Not watering.';

  const tankTone = !hasStatus ? 'neutral' : reservoir?.state === 'available' ? 'live' : reservoir?.state === 'low' ? 'warn' : 'neutral';
  const tankWord = hasStatus ? reservoirLabel(reservoir?.state) : 'Unknown';

  const soilWord = !hasStatus
    ? 'Unknown'
    : soil?.calibrated
      ? soilLabel(soil.state)
      : soil?.state === 'uncalibrated'
        ? 'Not calibrated'
        : 'Unknown';

  const example = (VOICE_EXAMPLES[language] ?? VOICE_EXAMPLES.en)[0];
  const languageName = VOICE_LANGUAGE_NAMES[language] ?? 'English';

  return (
    <div className="page village-page">
      {Boolean(error) && !envelope && (
        <Notice tone="bad" title="The village service is not answering.">
          Cards below show what is known. Readings stay “Unknown” until the backend answers.{' '}
          <button type="button" className="link-btn" onClick={reload}>
            Try again
          </button>{' '}
          A presenter can check the connection in <Link to="/setup#connections">Setup</Link>.
        </Notice>
      )}
      {!envelope && loading && (
        <p className="hint" role="status">
          Waiting for the first frame from the controller…
        </p>
      )}
      {/* The status strip above already says the controller is offline or how
          old the frame is.  Repeating it here was the duplicate connection
          warning; the cards carry their own state. */}

      <section className="voice-invite" aria-labelledby="voice-invite-title">
        <div className="voice-invite-main">
          <p className="eyebrow">Talk to our village</p>
          <h2 className="voice-invite-title" id="voice-invite-title">
            Say one short command
          </h2>
          <p className="voice-invite-text">
            In {languageName}, try <em>“{example.phrase}”</em>. The board answers with its LEDs and
            the pump.
          </p>
        </div>
        <div className="voice-invite-side">
          <LanguagePicker
            options={VOICE_LANGUAGES.map((entry) => ({ code: entry.code, label: entry.label }))}
            value={language}
            onChange={(code) => setLanguage(code as VoiceLanguage)}
            label="Language for the voice invitation"
            testId="invite-lang"
          />
          <div className="voice-invite-actions">
            <button
              type="button"
              className="btn btn--gold btn--large"
              onClick={openPanel}
              data-testid="start-voice"
            >
              <IconMic size={18} /> Start Speaking
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => openLia('voice')}>
              Help with voice
            </button>
          </div>
        </div>
      </section>

      <div className="village-grid">
        <article className="vcard" data-testid="card-plants">
          <header className="vcard-head">
            <span className="vcard-icon">
              <IconDroplet size={20} />
            </span>
            <h2>Plants &amp; Watering</h2>
            {levelChip(
              !hasStatus ? 'Status unknown' : watering ? 'Watering' : 'Idle',
              watering ? 'live' : 'neutral',
            )}
          </header>

          {stateLine(
            hasStatus ? `${soilWord}${soilPercent ? ` · ${soilPercent} moisture` : ''}` : 'No soil reading yet',
            soil?.state === 'dry' ? 'warn' : 'neutral',
          )}
          <p className="vcard-fact">
            {waterState}
            {irrigation?.reason && !waterBlocked ? ` ${irrigation.reason}` : ''}
          </p>

          <div className="vcard-actions">
            <button
              type="button"
              className="btn btn--primary btn--large"
              data-testid="water-plants"
              disabled={startDisabled}
              title={waterBlocked || 'Ask the controller for one short, safe watering pulse.'}
              onClick={() => void run('water', 'plants', 'IRRIGATION_REQUEST')}
            >
              <IconPlay size={17} /> Water Plants
            </button>
            <button
              type="button"
              className="btn btn--danger"
              data-testid="stop-watering"
              disabled={stopDisabled}
              title="Stop watering now. This is safe to press even when nothing is running."
              onClick={() => void run('stop', 'plants', 'IRRIGATION_STOP')}
            >
              <IconStop size={17} /> Stop Watering
            </button>
          </div>
          {waterBlocked && <p className="hint">{waterBlocked}</p>}
          {pumpCommissioned === false && (
            <p className="hint">
              A presenter can open the commissioning gate in <Link to="/setup#advanced">Setup</Link>.
            </p>
          )}

          <p className="vcard-try">
            <strong>Try:</strong> press <em>Water Plants</em>.
          </p>
          <p className="vcard-watch">
            <strong>Watch:</strong> drops coming from the irrigation tube.
          </p>
          {feedback.plants && entries.find((row) => row.id === feedback.plants) && (
            <CommandResult entry={entries.find((row) => row.id === feedback.plants)!} />
          )}
          <details className="advanced vcard-more">
            <summary>How it works</summary>
            <div className="advanced-body">
              <p>
                The controller waters only when the soil is dry and the tank has water. It runs one
                short pulse, waits, then decides again. The board refuses a start it cannot carry
                out safely.
              </p>
              <p className="hint">
                An acknowledgement means the controller decided. It does not prove that water
                flowed.
              </p>
            </div>
          </details>
        </article>

        <article className="vcard" data-testid="card-tank">
          <header className="vcard-head">
            <span className="vcard-icon">
              <IconPump size={20} />
            </span>
            <h2>Rainwater Tank</h2>
            {levelChip(tankWord, tankTone)}
          </header>

          {stateLine(
            !hasStatus
              ? 'The tank level is unknown until the board answers.'
              : reservoir?.state === 'available'
                ? 'Water is above the minimum level.'
                : reservoir?.state === 'low'
                  ? 'Water is at or below the minimum level.'
                  : 'No usable probe reading. The app does not guess a level.',
            reservoir?.state === 'available' ? 'good' : reservoir?.state === 'low' ? 'warn' : 'neutral',
          )}
          <p className="vcard-fact">
            Shows whether enough water is available for the pump.
            {reservoir?.millivolts !== null && reservoir?.millivolts !== undefined
              ? ` Probe ${Math.round(reservoir.millivolts)} mV.`
              : ''}
          </p>

          <p className="vcard-try">
            <strong>Try:</strong>{' '}
            {reservoir?.state === 'low'
              ? 'refill the tank; the state changes after a few seconds.'
              : 'lift the probes out of the water to see it change to “Low”.'}
          </p>
          <p className="vcard-watch">
            <strong>Watch:</strong> the probe tips and the water line.
          </p>
          <details className="advanced vcard-more">
            <summary>How it works</summary>
            <div className="advanced-body">
              <p>
                Two wires report one minimum level — never a percentage or a number of litres. When
                the tips are covered, the controller allows the pump; when they are dry, it blocks
                watering.
              </p>
            </div>
          </details>
        </article>

        <article className="vcard" data-testid="card-lights">
          <header className="vcard-head">
            <span className="vcard-icon">
              <IconLamp size={20} />
            </span>
            <h2>Streetlights</h2>
            {levelChip(hasStatus ? lightWord : 'Unknown', light?.brightness === 'dark' ? 'gold' : 'neutral')}
          </header>

          {stateLine(
            !hasStatus
              ? 'Lamp mode unknown — the board has not reported it.'
              : !lightWired
                ? 'No light sensor is fitted, so there is no brightness reading.'
                : lightMode === null
                  ? 'The lamp mode is unknown right now.'
                  : `The light sensor reads ${lightWord.toLowerCase()}. The lights are ${
                      lightMode === 'on' ? 'on' : lightMode === 'off' ? 'off' : 'following the sensor'
                    } (${lightModeLabel(lights?.mode)}).`,
            lightMode === 'on' ? 'good' : 'neutral',
          )}

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
                {mode === 'auto' ? 'Automatic' : mode === 'on' ? 'On' : 'Off'}
              </button>
            ))}
          </div>
          {!hasStatus && (
            <p className="hint">No lighting mode is selected because the actual mode is unknown.</p>
          )}
          {physicalDisabled && <p className="hint">The controller is offline, so the lights cannot be switched.</p>}

          <p className="vcard-try">
            <strong>Try:</strong> choose <em>Automatic</em>, then cover the light sensor.
          </p>
          <p className="vcard-watch">
            <strong>Watch:</strong> the streetlight LEDs change after about four seconds.
          </p>
          <details className="advanced vcard-more">
            <summary>How it works</summary>
            <div className="advanced-body">
              <p>
                Automatic follows the light sensor. On and Off override it until you choose
                Automatic again. The rule runs on the board, so it does not need this page.
              </p>
            </div>
          </details>
          {feedback.lights && entries.find((row) => row.id === feedback.lights) && (
            <CommandResult entry={entries.find((row) => row.id === feedback.lights)!} />
          )}
        </article>

        <article className="vcard" data-testid="card-waste">
          <header className="vcard-head">
            <span className="vcard-icon">
              <IconCamera size={20} />
            </span>
            <h2>Waste</h2>
            {modelChip}
          </header>

          {stateLine(
            waste?.active && waste.category
              ? `Last item: ${waste.category}. The ${waste.category} bin LED is lit.`
              : latestRecognition
                ? friendlyEvent(latestRecognition).title
                : 'No item has been shown to the camera yet.',
            waste?.active ? 'good' : 'neutral',
          )}

          <p className="vcard-fact">
            {bins.length > 0
              ? bins
                  .map((bin: BinReading) => `${bin.id.replace(/^\w/, (c) => c.toUpperCase())}: ${binLabel(bin.state)}`)
                  .join(' · ')
              : 'Bin fill is unavailable until the distance sensors report.'}
          </p>

          <div className="vcard-actions">
            <button
              type="button"
              className="btn btn--primary btn--large"
              onClick={() => navigate('/waste')}
              data-testid="open-sort-waste"
            >
              <IconCamera size={17} /> Open Sort Waste
            </button>
          </div>

          <p className="vcard-try">
            <strong>Try:</strong> show one clean item to the camera.
          </p>
          <p className="vcard-watch">
            <strong>Watch:</strong> the suggested bin and its LED.
          </p>
          <details className="advanced vcard-more">
            <summary>How it works</summary>
            <div className="advanced-body">
              <p>
                The camera suggests a bin; it does not prove that the item was put in it. Bin fill
                comes from the distance sensors.
              </p>
            </div>
          </details>
        </article>
      </div>

      <div className="village-strip village-strip--single">
        <Card
          className="recent-card"
          kicker="Just now"
          title="What happened"
          actions={
            <Link to="/activity" className="link-inline">
              See all
            </Link>
          }
        >
          {events.error ? (
            <p className="hint">Activity history unavailable. The log could not be read.</p>
          ) : events.loading && rows.length === 0 ? (
            <p className="hint">Reading the village diary…</p>
          ) : recent.length === 0 ? (
            <p className="hint">Nothing has been recorded yet.</p>
          ) : (
            <ul className="mini-timeline">
              {recent.map((event, index) => {
                const friendly = friendlyEvent(event);
                return (
                  <li key={event.id ?? `${friendly.title}-${index}`}>
                    <span className="mini-time">
                      {eventTime(event)
                        ? new Date(eventTime(event)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </span>
                    <span className="mini-text">{friendly.title}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {simulator && (
        <p className="hint">
          <IconInfo size={14} /> Simulation is on: the cards read generated data and the physical
          board will not respond.
        </p>
      )}
    </div>
  );
}

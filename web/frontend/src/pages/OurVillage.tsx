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
import { Card, Chip, Notice } from '../components/ui';
import { api } from '../lib/api';
import { useCommands } from '../lib/commands';
import { binLabel, lightModeLabel, reservoirLabel, soilLabel } from '../lib/explain';
import { cx, formatAge, formatPercent } from '../lib/format';
import { openLia } from '../lib/liaUi';
import { friendlyEvent } from '../lib/timeline';
import { useApi } from '../lib/useApi';
import { useVillage } from '../lib/village';
import { useVoiceUi } from '../lib/voiceUi';
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
    live,
    connected,
    stale,
    ageMs,
    demo,
    simulator,
  } = useVillage();
  const { send, entries } = useCommands();
  const { openPanel } = useVoiceUi();
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

  const watering = irrigation?.state === 'pumping' || irrigation?.state === 'soaking';
  const physicalDisabled = !connected && !demo;
  const pumpCommissioned = Boolean(pump?.commissioned);
  const lightWired = light?.installed !== false;
  const lightMode = lights?.mode === 'auto' ? 'auto' : lights?.commanded ? 'on' : 'off';
  const lightWord = !lightWired ? 'Unknown' : light?.brightness === 'dark' ? 'Dark' : light?.brightness === 'bright' ? 'Bright' : 'Unknown';

  const soilPercent = soil?.calibrated && soil.percent !== null ? formatPercent(soil.percent, 0) : null;

  const rows = events.data?.events ?? events.data?.items ?? [];
  const latestRecognition = rows.find((row) => {
    const raw = `${row.kind ?? ''} ${row.type ?? ''} ${row.code ?? ''}`.toLowerCase();
    return raw.includes('recogn') || raw.includes('waste');
  });
  const recent = rows.slice(0, 3);

  const modelInstalled = model.data?.installed ?? model.data?.available ?? model.data?.present;
  const modelChip = model.error
    ? levelChip('Status unknown', 'neutral')
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
  // letting a visitor press a button that can only be refused.
  const waterBlocked = !pumpCommissioned
    ? 'The pump is not commissioned, so watering is disabled.'
    : reservoir?.state === 'low'
      ? 'The tank water is low. Refill the reservoir before watering.'
      : reservoir?.state !== 'available'
        ? 'The tank reading is not available, so watering is disabled.'
        : soil?.state === 'wet' || soil?.state === 'adequate'
          ? 'The soil is already moist, so watering is not needed.'
          : !soil?.calibrated
            ? 'The soil probe is not calibrated, so the controller will refuse to water.'
            : physicalDisabled
              ? 'The controller is offline. Actions are disabled.'
              : '';

  const startDisabled = busy !== null || watering || Boolean(waterBlocked);
  const stopDisabled = busy !== null;

  const waterState = watering
    ? irrigation?.state === 'pumping'
      ? 'Watering now'
      : 'Soaking — the pump is resting'
    : irrigation?.state === 'cooldown'
      ? 'Cooling down after a watering session'
      : 'Not watering';

  const tankTone = reservoir?.state === 'available' ? 'live' : reservoir?.state === 'low' ? 'warn' : 'neutral';
  const tankWord = reservoirLabel(reservoir?.state);

  const soilWord = soil?.calibrated ? soilLabel(soil.state) : soil?.state === 'uncalibrated' ? 'Not calibrated' : 'Unknown';

  return (
    <div className="page village-page">
      {Boolean(error) && !envelope && (
        <Notice tone="bad" title="The village service is not answering">
          Cards below show what is known. Readings stay “Unknown” until the backend answers.{' '}
          <button type="button" className="link-btn" onClick={reload}>
            Try again
          </button>
        </Notice>
      )}
      {!envelope && loading && (
        <p className="hint" role="status">
          Waiting for the first frame from the controller…
        </p>
      )}
      {envelope && !live && (
        <p className="hint" role="status">
          {stale
            ? `These readings are ${formatAge(ageMs)} old, not live.`
            : 'No live reading. The cards keep their last values and actions are disabled.'}{' '}
          {status?.irrigation?.reason}
        </p>
      )}

      <div className="village-grid">
        <article className="vcard" data-testid="card-plants">
          <header className="vcard-head">
            <span className="vcard-icon">
              <IconDroplet size={20} />
            </span>
            <h2>Plants &amp; Watering</h2>
            {levelChip(watering ? 'Watering' : 'Idle', watering ? 'live' : 'neutral')}
          </header>

          {stateLine(`${soilWord}${soilPercent ? ` · ${soilPercent} moisture` : ''}`, soil?.state === 'dry' ? 'warn' : 'neutral')}
          <p className="vcard-fact">
            {waterState}. {irrigation?.reason ?? 'The controller has not reported a reason yet.'}
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
          {!pumpCommissioned && (
            <p className="hint">
              A presenter can open the commissioning gate in <Link to="/setup#advanced">Setup</Link>.
            </p>
          )}

          <p className="vcard-try">
            <strong>Try:</strong> press <em>Water Plants</em>. The controller runs one short pulse,
            then waits.
          </p>
          <p className="vcard-watch">
            <strong>Watch the model:</strong> the drip outlet. An acknowledgement means the
            controller decided — it does not prove water flowed.
          </p>
          {feedback.plants && entries.find((row) => row.id === feedback.plants) && (
            <CommandResult entry={entries.find((row) => row.id === feedback.plants)!} />
          )}
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
            reservoir?.state === 'available'
              ? 'Water is above the minimum level.'
              : reservoir?.state === 'low'
                ? 'Water is at or below the minimum level.'
                : 'No usable probe reading. The app does not guess a level.',
            reservoir?.state === 'available' ? 'good' : reservoir?.state === 'low' ? 'warn' : 'neutral',
          )}
          <p className="vcard-fact">
            Two wires report one minimum level — never a percentage or a number of litres.
            {reservoir?.millivolts !== null && reservoir?.millivolts !== undefined
              ? ` Probe reading ${Math.round(reservoir.millivolts)} mV.`
              : ''}
          </p>

          <p className="vcard-try">
            <strong>Try:</strong>{' '}
            {reservoir?.state === 'low'
              ? 'refill the tank until the probes are covered; the state changes after a few seconds.'
              : 'lift the probes out of the water to see it change to “Low”.'}
          </p>
          <p className="vcard-watch">
            <strong>Watch the model:</strong> the two probe tips and the water line. Keep the probes
            above the pump intake.
          </p>
        </article>

        <article className="vcard" data-testid="card-lights">
          <header className="vcard-head">
            <span className="vcard-icon">
              <IconLamp size={20} />
            </span>
            <h2>Streetlights</h2>
            {levelChip(lightWord, light?.brightness === 'dark' ? 'gold' : 'neutral')}
          </header>

          {stateLine(
            !lightWired
              ? 'No light sensor is fitted, so there is no brightness reading.'
              : `The light sensor reads ${lightWord.toLowerCase()}. The lights are ${lights?.commanded ? 'commanded on' : 'commanded off'} (${lightModeLabel(lights?.mode)}).`,
            lights?.commanded ? 'good' : 'neutral',
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
          {physicalDisabled && <p className="hint">The controller is offline, so the lights cannot be switched.</p>}

          <p className="vcard-try">
            <strong>Try:</strong> choose <em>Automatic</em>, then cover the light sensor and wait
            about four seconds.
          </p>
          <p className="vcard-watch">
            <strong>Watch the model:</strong> the four streetlight LEDs. Automatic follows the
            sensor; On and Off override it until you choose Automatic again.
          </p>
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
            <strong>Try:</strong> show one clean item to the camera. The screen suggests a bin and
            lights that bin&apos;s LED.
          </p>
          <p className="vcard-watch">
            <strong>Watch the model:</strong> the three bin LEDs. Recognition is a suggestion, not
            proof that the item was put in the bin.
          </p>
        </article>
      </div>

      <div className="village-strip">
        <Card className="voice-card" kicker="Speak to the village" title="Try a voice command">
          <p>
            In English, മലയാളം or हिन्दी, say <em>“turn on the lights”</em> or{' '}
            <em>“water the plants”</em>.
          </p>
          <div className="village-strip-actions">
            <button type="button" className="btn btn--gold btn--large" onClick={openPanel}>
              <IconMic size={18} /> Start voice
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => openLia('voice')}>
              Help me use voice
            </button>
          </div>
        </Card>

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
          {recent.length === 0 ? (
            <p className="hint">Nothing has been recorded yet.</p>
          ) : (
            <ul className="mini-timeline">
              {recent.map((event, index) => {
                const friendly = friendlyEvent(event);
                return (
                  <li key={event.id ?? `${friendly.title}-${index}`}>
                    <span className="mini-time">
                      {event.at ? new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
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

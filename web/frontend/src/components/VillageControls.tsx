import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCommands } from '../lib/commands';
import { cx } from '../lib/format';
import { isWatering } from '../lib/explain';
import { useVillage } from '../lib/village';
import { useVoiceUi } from '../lib/voiceUi';
import { CommandResult } from './CommandResult';
import {
  IconCamera,
  IconDroplet,
  IconLamp,
  IconMic,
  IconPlay,
  IconStop,
} from './Icons';

export function VillageControls({ compact = false }: { compact?: boolean }) {
  const { status, connected, demo, live } = useVillage();
  const { send } = useCommands();
  const { openPanel } = useVoiceUi();
  const navigate = useNavigate();
  const { entries } = useCommands();
  const [busy, setBusy] = useState<string | null>(null);

  const watering = isWatering(status);
  const pumpCommissioned = Boolean(status?.actuators?.pump?.commissioned);
  const lights = status?.actuators?.streetlights;
  const lightMode = lights?.mode === 'auto' ? 'auto' : lights?.commanded ? 'on' : 'off';

  const run = async (type: string) => {
    setBusy(type);
    try {
      await send(type);
    } finally {
      setBusy(null);
    }
  };

  const physicalDisabled = !connected && !demo;
  const feedback = entries[0] ?? null;
  const stopLabel = connected ? 'Stop irrigation' : 'Stop (not confirmed)';

  if (compact) {
    return (
      <div className="quick-controls">
        <div className="quick-control-row">
          <button
            type="button"
            className="btn btn--primary"
            data-testid="start-irrigation-quick"
            disabled={physicalDisabled || busy !== null || watering}
            onClick={() => void run('IRRIGATION_REQUEST')}
          >
            <IconPlay size={16} /> Start irrigation
          </button>
          {(watering || demo) && (
            <button
              type="button"
              className="btn btn--danger"
              data-testid="stop-irrigation-quick"
              disabled={busy !== null}
              onClick={() => void run('IRRIGATION_STOP')}
            >
              <IconStop size={16} /> {stopLabel}
            </button>
          )}
        </div>
        <p className="hint">Full controls, commissioning and the command log are on the Controls page.</p>
      </div>
    );
  }

  return (
    <div className="village-controls">
      {demo && (
        <p className="hint demo-hint">
          Demo mode is on: these presses are simulated. The page still uses the same command
          endpoint, with <code>mode: demo</code>.
        </p>
      )}

      {physicalDisabled && (
        <p className="notice notice--warn">
          The controller is offline. Stop stays available so you can try to stop a running session,
          but nothing can be confirmed.
        </p>
      )}

      <div className="control-grid">
        <div className="control-group">
          <p className="control-label">
            <IconDroplet size={16} /> Irrigation
          </p>
          <div className="control-actions">
            <button
              type="button"
              className="btn btn--primary"
              data-testid="start-irrigation"
              disabled={physicalDisabled || busy !== null || watering || !pumpCommissioned}
              title={
                !pumpCommissioned
                  ? 'The pump is not commissioned. The firmware will refuse to start it.'
                  : watering
                    ? 'A session is already running.'
                    : 'Ask the controller to start a short irrigation pulse.'
              }
              onClick={() => void run('IRRIGATION_REQUEST')}
            >
              <IconPlay size={16} /> Start irrigation
            </button>
            {(watering || demo) && (
              <button
                type="button"
                className="btn btn--danger"
                data-testid="stop-irrigation"
                disabled={busy !== null}
                onClick={() => void run('IRRIGATION_STOP')}
              >
                <IconStop size={16} /> {stopLabel}
              </button>
            )}
          </div>
          <p className="hint">
            {pumpCommissioned
              ? 'The commissioning gate is open. The controller still applies every safety check.'
              : 'The commissioning gate is closed, so the controller will refuse a start.'}
          </p>
        </div>

        <div className="control-group">
          <p className="control-label">
            <IconLamp size={16} /> Streetlights
          </p>
          <div className="segmented" role="group" aria-label="Streetlight mode">
            {(['auto', 'on', 'off'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-testid={`lights-${mode}`}
                className={cx('segment', lightMode === mode && 'is-active')}
                aria-pressed={lightMode === mode}
                disabled={physicalDisabled || busy !== null}
                onClick={() =>
                  void run(
                    mode === 'auto' ? 'LIGHTS_AUTO' : mode === 'on' ? 'LIGHTS_ON' : 'LIGHTS_OFF',
                  )
                }
              >
                {mode === 'auto' ? 'Auto' : mode === 'on' ? 'On' : 'Off'}
              </button>
            ))}
          </div>
          <p className="hint">
            Auto follows the light sensor with hysteresis. Manual On/Off overrides it until you
            return to Auto.
          </p>
        </div>
      </div>

      <div className="control-links">
        <button type="button" className="btn btn--ghost" onClick={openPanel}>
          <IconMic size={16} /> Voice command
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigate('/waste')}>
          <IconCamera size={16} /> Waste camera
        </button>
      </div>

      {feedback && (
        <div className="control-feedback">
          <p className="eyebrow">Last command</p>
          <CommandResult entry={feedback} />
        </div>
      )}

      <p className="hint honest-note">
        An acknowledgement means the controller received the command and decided. It does not prove
        that water flowed or that an LED lit.
        {!live && ' These values are not live.'}
      </p>
    </div>
  );
}

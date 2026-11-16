import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib/api';
import { useCommands } from '../lib/commands';
import { useVillage } from '../lib/village';
import { Toggle } from './Toggle';
import { IconPlug } from './Icons';

/**
 * The bench test, as the exhibit's one panel.
 *
 * Opening the panel **is** test mode: it sends `TEST_MODE on`, which takes the
 * pump and the four LEDs away from the village drivers.  Closing it sends
 * `TEST_MODE off`, which releases whatever the five switches were holding and
 * hands the pins back — the board does the same on its own after a reboot,
 * because the flag is session-only.
 *
 * It is deliberately blunt, at the operator's own instruction (2026-11-16):
 * past the switch there is no oversight of the soil probe, the tank probe, the
 * commissioning gate or the kill switch.  What protects the pump is the
 * operator's hand and the fact that closing the panel stops everything.
 */
export function TestModeDialog({
  onClose,
  onReleaseFailed,
}: {
  onClose: () => void;
  /** The panel is closed; if the board did not confirm the release, say so. */
  onReleaseFailed: (message: string) => void;
}) {
  const { status, connected, reload } = useVillage();
  const { send } = useCommands();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [arming, setArming] = useState(true);
  const [armFailed, setArmFailed] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);

  const test = status?.test;
  const enabled = Boolean(test?.enabled);

  // Opening the panel turns test mode on.  Cancelled on unmount, so a panel
  // closed while the command is in flight cannot resurrect it.
  useEffect(() => {
    let live = true;
    void send('TEST_MODE', { on: true })
      .then((outcome) => {
        if (!live) return;
        if (!outcome.ok) {
          setArmFailed(outcome.reason ?? 'The controller refused test mode.');
        } else {
          reload();
        }
      })
      .catch((cause) => {
        if (live) setArmFailed(errorMessage(cause));
      })
      .finally(() => {
        if (live) setArming(false);
      });
    return () => {
      live = false;
    };
  }, [send, reload]);

  // A panel with the keyboard focus inside it, Esc to leave, and the page
  // behind it pinned so a wheel cannot scroll the village out from under it.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    doneRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  const close = useCallback(() => {
    // The panel closes at once -- closing is the operator's command, not
    // something to wait three seconds for.  The release is reported after the
    // fact if the board did not confirm it.
    onClose();
    void send('TEST_MODE', { on: false })
      .then((outcome) => {
        if (!outcome.ok) {
          // The bare reason ("unconfirmed") does not say what it costs, and what
          // it costs is that a pin may still be held high.
          onReleaseFailed(
            `The controller did not confirm that test mode ended, so the outputs may still be held. ${
              outcome.reason ?? ''
            }`.trim(),
          );
        }
      })
      .catch((cause) => {
        onReleaseFailed(
          `The controller did not answer, so the outputs may still be held: ${errorMessage(cause)}`,
        );
      });
  }, [onClose, onReleaseFailed, send]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const command = async (key: string, output: string, on: boolean) => {
    setBusy(key);
    setError('');
    try {
      const outcome = await send('TEST_OUTPUT', { output, on });
      if (!outcome.ok) setError(outcome.reason ?? 'The controller refused that output.');
      reload();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const rows = [
    {
      output: 'pump',
      label: 'Pump / motor (D19)',
      on: Boolean(test?.pump),
      // The pad, not the intent: a switch that is on while the pin is low is
      // exactly the failure this note exists to make visible.
      note: test ? `D19 is ${test.pump_pin ? 'HIGH' : 'LOW'}` : undefined,
    },
    { output: 'led_organic', label: 'Organic LED (D21)', on: Boolean(test?.leds?.organic), note: undefined },
    { output: 'led_plastic', label: 'Plastic LED (D22)', on: Boolean(test?.leds?.plastic), note: undefined },
    { output: 'led_paper', label: 'Paper LED (D23)', on: Boolean(test?.leds?.paper), note: undefined },
    {
      output: 'streetlights',
      label: 'Streetlights (D13)',
      on: Boolean(test?.leds?.streetlights),
      note: undefined,
    },
  ];

  const offline = !connected;

  return (
    <div className="overlay-over" role="presentation">
      <div
        className="test-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Test outputs"
        ref={panelRef}
        data-testid="test-dialog"
      >
        <header className="test-dialog-head">
          <div>
            <p className="brand-eyebrow">Bench test</p>
            <h2 className="test-dialog-title">Test outputs</h2>
          </div>
          <button
            type="button"
            className="btn btn--gold"
            onClick={close}
            ref={doneRef}
            data-testid="test-done"
          >
            Done — back to live
          </button>
        </header>

        {arming && <p className="hint" role="status">Turning test mode on…</p>}

        {armFailed && (
          <div className="test-dialog-blocked" data-testid="test-arm-error">
            <p className="error-text">{armFailed}</p>
            <p className="hint">
              The switches stay disabled until the controller accepts test mode, because a switch
              that can only be refused looks like a broken pin.
            </p>
          </div>
        )}

        {offline && !arming && (
          <p className="hint" data-testid="test-offline">
            The controller is not answering, so these switches cannot be changed.
          </p>
        )}

        <p className="hint">
          Test mode takes the pump and the four LEDs from the village until this panel is closed.
          Nothing here is protected by the soil or tank probes — the switches go straight to the
          pins.
        </p>

        <div className="test-dialog-rows">
          {rows.map((row) => (
            <div className="test-dialog-row" key={row.output}>
              <div>
                <p className="setting-name">{row.label}</p>
                {row.note && <p className="hint">{row.note}</p>}
              </div>
              <Toggle
                id={`dialog-test-${row.output}`}
                label={row.label}
                checked={row.on}
                disabled={busy !== null || offline || !enabled}
                onChange={(next) => void command(row.output, row.output, next)}
              />
            </div>
          ))}
        </div>

        {error && (
          <p className="error-text" role="alert" data-testid="test-dialog-error">
            {error}
          </p>
        )}

        <footer className="test-dialog-foot">
          <IconPlug size={16} />
          <span>
            Closing this switches every output off and gives the pins back to the village.
          </span>
        </footer>
      </div>
    </div>
  );
}

import { useCallback, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useSession } from '../lib/session';
import { useDemo } from '../lib/demo';
import { useVillage } from '../lib/village';
import { Emblem } from './Emblem';
import { ConnectionPill } from './ConnectionPill';
import { IconSignOut } from './Icons';
import { ModeSwitch, type VillageMode } from './ModeSwitch';
import { TestModeDialog } from './TestModeDialog';
import { LiaGuide } from './LiaGuide';

/**
 * The exhibit's one screen: a centred mark and name, the three-stop mode knob,
 * and whatever the address names.
 *
 * No side menu, deliberately.  This laptop stands in a room, and a menu invites
 * a visitor into Setup; the operator's pages (Setup, What Happened, About) are
 * still in the router and reachable by address.
 *
 * The three stops are three different facts, so each says what it is:
 *
 *  - **Simulation** — invented readings (`village.demoMode = demo`), so the
 *    page can be shown with the board off.
 *  - **Live** — the controller's own numbers, the middle stop and the default.
 *  - **Test** — the bench panel: it takes the pump and the four LEDs away from
 *    the village until the panel is closed.  Offered only while the controller
 *    answers, because a test that can only be refused is a broken-looking pin.
 */
export function KioskLayout() {
  const { demo, setMode: setDemoMode } = useDemo();
  const { connected } = useVillage();
  const { username, signOut } = useSession();
  const [testOpen, setTestOpen] = useState(false);
  const [warning, setWarning] = useState('');

  const testUnavailable = demo
    ? 'Not available in Simulation — switch to Live first.'
    : !connected
      ? 'Connect the controller to use test mode.'
      : null;

  // Derived, not remembered: Setup keeps its own Simulation switch, and the
  // knob must show what is true rather than what was last pressed here.
  const mode: VillageMode = testOpen ? 'test' : demo ? 'simulation' : 'live';

  const choose = (next: VillageMode) => {
    if (next === 'test') {
      if (testUnavailable !== null) return;
      setWarning('');
      // Test is not the board's mode: the readings stay live while the bench
      // panel holds the outputs.
      setDemoMode('live');
      setTestOpen(true);
      return;
    }
    setWarning('');
    setDemoMode(next === 'simulation' ? 'demo' : 'live');
  };

  const releaseFailed = useCallback((message: string) => setWarning(message), []);

  return (
    <div className="kiosk-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="kiosk-head">
        <div className="kiosk-head-grid">
          <span aria-hidden="true" />
          {/* The mark is the way home: the operator's pages (Setup, About,
              What Happened) are reachable only by address, and arriving on one
              must not strand anybody. */}
          <Link to="/" className="kiosk-brand" aria-label="Smart Green Village — back to the village">
            <Emblem size={44} />
            <span className="kiosk-name">Smart Green Village</span>
          </Link>
          <div className="kiosk-tools">
            <ConnectionPill />
            {username && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => void signOut()}
                title={`Signed in as ${username} — sign out`}
                aria-label="Sign out"
                data-testid="sign-out"
              >
                <IconSignOut size={17} />
              </button>
            )}
          </div>
        </div>

        <div className="kiosk-modes">
          <ModeSwitch value={mode} onChange={choose} testUnavailable={testUnavailable} />
          {testUnavailable && (
            <p className="kiosk-note" data-testid="mode-note">
              {testUnavailable}
            </p>
          )}
        </div>
        {warning && (
          <p className="kiosk-note kiosk-note--warn" role="alert" data-testid="mode-warning">
            {warning}
          </p>
        )}
      </header>

      <main id="main-content" className="kiosk-main">
        <Outlet />
      </main>

      {/* The guide is mounted by the shell, above the routes, so "Talk to
          Sara" works on every page it is offered on. */}
      <LiaGuide />

      {testOpen && (
        <TestModeDialog
          onClose={() => {
            setTestOpen(false);
            // Closing the bench panel is the way back to live control.
            setDemoMode('live');
          }}
          onReleaseFailed={releaseFailed}
        />
      )}
    </div>
  );
}

import { useEffect, useState, type ReactElement } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useDemo } from '../lib/demo';
import { cx, formatAge } from '../lib/format';
import { PAGES, pageMeta } from '../lib/pages';
import { useVillage } from '../lib/village';
import { useVoiceUi } from '../lib/voiceUi';
import { Emblem } from './Emblem';
import {
  IconActivity,
  IconControls,
  IconDashboard,
  IconMenu,
  IconMic,
  IconSensors,
  IconSettings,
  IconVillagers,
  IconWaste,
} from './Icons';
import { LiaGuide } from './LiaGuide';
import { StatusStrip } from './StatusStrip';

const NAV_ICONS: Record<string, (props: { size?: number }) => ReactElement> = {
  '/': IconDashboard,
  '/sensors': IconSensors,
  '/controls': IconControls,
  '/waste': IconWaste,
  '/activity': IconActivity,
  '/settings': IconSettings,
  '/villagers': IconVillagers,
};

function DemoSwitch() {
  const { demo, toggle } = useDemo();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={demo}
      className={cx('demo-switch', demo && 'is-on')}
      onClick={toggle}
      title={
        demo
          ? 'Demo mode is on: every request asks the backend for simulated data.'
          : 'Demo mode is off: requests ask for the live village.'
      }
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
      <span className="demo-switch-label">Demo</span>
    </button>
  );
}

function ConnectionPill() {
  const { connected, stale, connection, ageMs } = useVillage();
  const label = !connected ? 'Offline' : stale ? 'Stale' : 'Live';
  const tone = !connected ? 'offline' : stale ? 'stale' : 'live';
  return (
    <span
      className={cx('conn-pill', `conn-pill--${tone}`)}
      title={
        connected
          ? `Last successful frame ${formatAge(ageMs)}${connection?.last_success_at ? ` at ${connection.last_success_at}` : ''}`
          : connection?.last_error ?? 'No live frame from the controller.'
      }
      data-testid="connection-pill"
    >
      <span className="dot" aria-hidden="true" />
      {label}
      {connected && !stale && ageMs !== null && <span className="conn-age">{formatAge(ageMs)}</span>}
    </span>
  );
}

export function Layout() {
  const location = useLocation();
  const meta = pageMeta(location.pathname);
  const { simulator } = useVillage();
  const { openPanel } = useVoiceUi();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <aside className={cx('sidebar', navOpen && 'is-open')} aria-label="Village navigation">
        <div className="brand">
          <Emblem size={66} />
          <div className="brand-copy">
            <span className="brand-eyebrow">Smart Green</span>
            <span className="brand-name">Village</span>
          </div>
        </div>

        <nav className="side-nav">
          {PAGES.map((page) => {
            const Icon = NAV_ICONS[page.path] ?? IconDashboard;
            return (
              <NavLink
                key={page.path}
                to={page.path}
                end={page.path === '/'}
                className={({ isActive }) => cx('nav-link', isActive && 'is-active')}
                title={page.kicker}
              >
                <Icon size={19} />
                <span>{page.navLabel}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="side-foot">
          <p className="eyebrow">Data source</p>
          <p className="source-line">
            <span className={cx('dot', simulator ? 'dot--gold' : 'dot--green')} aria-hidden="true" />
            {simulator ? 'Local simulator' : 'ESP32 over Wi-Fi'}
          </p>
          <p className="hint">Protocol v1 · private LAN only</p>
          <p className="hint">Not instrumented: solar, wind, buildings</p>
        </div>
      </aside>

      {navOpen && (
        <button
          type="button"
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}

      <div className="shell-main">
        <header className="appbar">
          <button
            type="button"
            className="icon-btn burger"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <IconMenu size={20} />
          </button>

          <div className="appbar-heading">
            <p className="appbar-kicker">{meta.kicker}</p>
            <h1 className="appbar-title">{meta.title}</h1>
          </div>

          <div className="appbar-actions">
            <ConnectionPill />
            <button
              type="button"
              className="icon-btn mic-btn"
              aria-label="Open voice command"
              title="Voice command"
              onClick={openPanel}
            >
              <IconMic size={19} />
            </button>
            <DemoSwitch />
          </div>
        </header>

        <StatusStrip />

        <main id="main-content" className="content">
          <Outlet />
        </main>
      </div>

      <LiaGuide />
    </div>
  );
}

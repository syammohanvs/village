import { useEffect, useState, type ReactElement } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { cx, formatAge } from '../lib/format';
import { openLia } from '../lib/liaUi';
import { PAGES, SETUP_PAGE, pageMeta } from '../lib/pages';
import { useVillage } from '../lib/village';
import { Emblem } from './Emblem';
import {
  IconActivity,
  IconDashboard,
  IconInfo,
  IconMenu,
  IconSettings,
  IconWaste,
} from './Icons';
import { LiaAvatar } from './LiaAvatar';
import { LiaGuide } from './LiaGuide';
import { StatusStrip } from './StatusStrip';

const NAV_ICONS: Record<string, (props: { size?: number }) => ReactElement> = {
  '/': IconDashboard,
  '/waste': IconWaste,
  '/activity': IconActivity,
  '/about': IconInfo,
  '/setup': IconSettings,
};

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

function TalkToLia({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      className={cx('talk-lia', compact && 'talk-lia--compact')}
      onClick={() => openLia('help')}
      data-testid="talk-to-lia"
      aria-label="Talk to Lia"
    >
      <LiaAvatar size={compact ? 30 : 40} decorative />
      {!compact && <span className="talk-lia-label">Talk to Lia</span>}
    </button>
  );
}

export function Layout() {
  const location = useLocation();
  const meta = pageMeta(location.pathname);
  const { simulator } = useVillage();
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
          <Emblem size={62} />
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
          <TalkToLia />
          <NavLink to={SETUP_PAGE.path} className="setup-link" data-testid="nav-setup">
            <IconSettings size={16} />
            <span>Setup</span>
          </NavLink>
          <p className="source-line" title={simulator ? 'Local simulator' : 'ESP32 over Wi-Fi'}>
            <span className={cx('dot', simulator ? 'dot--gold' : 'dot--green')} aria-hidden="true" />
            {simulator ? 'Simulator' : 'ESP32 over Wi-Fi'}
          </p>
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
            <h1 className="appbar-title">{meta.title}</h1>
          </div>

          <div className="appbar-actions">
            <ConnectionPill />
            <span className="appbar-lia">
              <TalkToLia compact />
            </span>
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

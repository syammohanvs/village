import { useEffect, useState, type ReactElement } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { cx, formatAge } from '../lib/format';
import { openLia } from '../lib/liaUi';
import { useSession } from '../lib/session';
import { PAGES, SETUP_PAGE, pageMeta } from '../lib/pages';
import { useVillage } from '../lib/village';
import { useDemo } from '../lib/demo';
import { Emblem } from './Emblem';
import {
  IconActivity,
  IconDashboard,
  IconInfo,
  IconMenu,
  IconSidebar,
  IconSignOut,
  IconSettings,
  IconWaste,
} from './Icons';
import { LiaAvatar } from './LiaAvatar';
import { LiaGuide } from './LiaGuide';

const NAV_ICONS: Record<string, (props: { size?: number }) => ReactElement> = {
  '/': IconDashboard,
  '/waste': IconWaste,
  '/activity': IconActivity,
  '/about': IconInfo,
  '/setup': IconSettings,
};

function clockOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString(undefined, { hour12: false });
}

const SIDEBAR_KEY = 'village.sidebar';

function ConnectionPill() {
  const { connected, stale, connection, ageMs } = useVillage();
  const { demo, setMode } = useDemo();
  // A clock that advances once a second is the cheapest honest proof that the
  // page is still being fed.  A relative "N ms ago" flickers between 0 and
  // 1000 because the backend polls every second, which reads as a frozen
  // counter rather than a live one.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const label = demo ? 'Simulation' : !connected ? 'Offline' : stale ? 'Stale' : 'Live';
  const tone = demo ? 'demo' : !connected ? 'offline' : stale ? 'stale' : 'live';
  const lastSuccess = connection?.last_success_at ?? null;
  const clock = clockOf(lastSuccess);
  const sinceLast = lastSuccess ? Math.max(0, now - Date.parse(lastSuccess)) : null;
  return (
    <span
      className={cx('conn-pill', `conn-pill--${tone}`)}
      title={
        demo
          ? 'Simulation mode: these readings are invented on the laptop. Press to go back to live readings.'
          : connected
            ? `Last frame from the controller: ${
                Number.isFinite(sinceLast) ? formatAge(sinceLast) : formatAge(ageMs)
              }${lastSuccess ? ` (${lastSuccess})` : ''}`
            : connection?.last_error ?? 'No live frame from the controller.'
      }
      data-testid="connection-pill"
      onClick={demo ? () => setMode('live') : undefined}
      role={demo ? 'button' : undefined}
      tabIndex={demo ? 0 : undefined}
      onKeyDown={
        demo
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setMode('live');
              }
            }
          : undefined
      }
    >
      <span className="dot" aria-hidden="true" />
      {label}
      {!demo && connected && !stale && clock && <span className="conn-age">{clock}</span>}
      {!demo && connected && stale && <span className="conn-age">{formatAge(ageMs)}</span>}
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
      aria-label="Talk to Sara"
    >
      <LiaAvatar size={compact ? 30 : 40} decorative />
      {!compact && <span className="talk-lia-label">Talk to Sara</span>}
    </button>
  );
}

export function Layout() {
  const location = useLocation();
  const meta = pageMeta(location.pathname);
  const isHome = location.pathname === '/';
  const { simulator } = useVillage();
  const [navOpen, setNavOpen] = useState(false);
  // Collapsed menu, remembered per device.  Expanded is the default: a rail is a
  // preference, never a state a first visit lands in.
  const { username: signedInAs, signOut } = useSession();
  const [rail, setRail] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_KEY) === 'rail';
    } catch {
      return false;
    }
  });
  const toggleRail = () => {
    setRail((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? 'rail' : 'full');
      } catch {
        /* storage can be unavailable in private modes */
      }
      return next;
    });
  };

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

      <aside
        className={cx('sidebar', rail && 'is-rail', navOpen && 'is-open')}
        aria-label="Village navigation"
      >
        <div className="brand">
          <Emblem size={rail ? 38 : 62} />
          {!rail && (
            <div className="brand-copy">
              <span className="brand-eyebrow">Smart Green</span>
              <span className="brand-name">Village</span>
            </div>
          )}
          {/* The menu can give the page its width back.  Remembered on this
              device, because it is a preference about the screen, not about the
              village. */}
          <button
            type="button"
            className="rail-toggle"
            data-testid="sidebar-toggle"
            aria-label={rail ? 'Expand the menu' : 'Collapse the menu'}
            aria-expanded={!rail}
            title={rail ? 'Expand the menu' : 'Collapse the menu'}
            onClick={toggleRail}
          >
            <IconSidebar size={17} />
          </button>
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
                title={rail ? page.navLabel : page.kicker}
                aria-label={page.navLabel}
              >
                <Icon size={19} />
                <span>{page.navLabel}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="side-foot">
          <TalkToLia compact={rail} />
          <NavLink
            to={SETUP_PAGE.path}
            className="setup-link"
            data-testid="nav-setup"
            title={rail ? 'Setup' : undefined}
            aria-label="Setup"
          >
            <IconSettings size={16} />
            <span>Setup</span>
          </NavLink>
          <p className="source-line" title={simulator ? 'Local simulator' : 'ESP32 over Wi-Fi'}>
            <span className={cx('dot', simulator ? 'dot--gold' : 'dot--green')} aria-hidden="true" />
            {simulator ? 'Simulator' : 'ESP32 over Wi-Fi'}
          </p>
          {signedInAs && (
            <button
              type="button"
              className="setup-link sign-out"
              onClick={() => void signOut()}
              title={`Signed in as ${signedInAs} — sign out`}
              data-testid="sign-out"
            >
              <IconSignOut size={16} />
              <span>Sign out</span>
            </button>
          )}
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

          {/* Every page names itself in the bar, including the home page.  It
              used to be hidden there ("the menu names it") and the consequence
              was the connection pill sitting alone on the left of the bar, with
              nothing to say which page you were on (reported 2026-11-16).  The
              home page still keeps its own big microphone instead of a second
              Talk button. */}
          <div className="appbar-heading">
            <h1 className="appbar-title">{meta.title}</h1>
          </div>

          <div className="appbar-actions">
            <ConnectionPill />
            {!isHome && (
              <span className="appbar-lia">
                <TalkToLia compact />
              </span>
            )}
          </div>
        </header>

        <main id="main-content" className="content">
          <Outlet />
        </main>
      </div>

      <LiaGuide />
    </div>
  );
}

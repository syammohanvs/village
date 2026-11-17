import { useEffect, useState } from 'react';
import { cx, formatAgeValue } from '../lib/format';
import { useT } from '../lib/i18n';
import { useVoiceUi } from '../lib/voiceUi';
import { useVillage } from '../lib/village';
import { useDemo } from '../lib/demo';

function clockOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString(undefined, { hour12: false });
}

/**
 * The one place connection state is reported (no banners anywhere).
 *
 * Moved out of `Layout` when the single-page exhibit needed the same pill
 * without a sidebar — two drawings of one fact is how they start disagreeing.
 */
export function ConnectionPill() {
  const { connected, stale, connection, ageMs } = useVillage();
  const { demo, setMode } = useDemo();
  const t = useT();
  const { language } = useVoiceUi();
  // A clock that advances once a second is the cheapest honest proof that the
  // page is still being fed.  A relative "N ms ago" flickers between 0 and
  // 1000 because the backend polls every second, which reads as a frozen
  // counter rather than a live one.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const label = demo
    ? t('conn.simulation')
    : !connected
      ? t('conn.offline')
      : stale
        ? t('conn.stale')
        : t('conn.live');
  const tone = demo ? 'demo' : !connected ? 'offline' : stale ? 'stale' : 'live';
  const lastSuccess = connection?.last_success_at ?? null;
  const clock = clockOf(lastSuccess);
  const sinceLast = lastSuccess ? Math.max(0, now - Date.parse(lastSuccess)) : null;
  return (
    <span
      className={cx('conn-pill', `conn-pill--${tone}`)}
      title={
        demo
          ? t('conn.simulationTitle')
          : connected
            ? t('conn.lastFrame', {
                // The duration is a number and a unit ("3s", "2m 5s"); only the
                // "ago" around it is a word, and that comes from the table.
                age: t('conn.age', {
                  duration: formatAgeValue(Number.isFinite(sinceLast) ? sinceLast : ageMs),
                }),
              }) + (lastSuccess ? ` (${lastSuccess})` : '')
            : // The backend's own error text is English and is the useful thing
              // to read while fixing a cable, so English keeps it.  The other
              // two languages say the same truth in the visitor's language
              // rather than switching alphabets mid-sentence.
              (language === 'en' && connection?.last_error
                ? connection.last_error
                : t('conn.noFrame'))
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
      {!demo && connected && stale && (
        <span className="conn-age">{t('conn.age', { duration: formatAgeValue(ageMs) })}</span>
      )}
    </span>
  );
}

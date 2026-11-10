import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { cx } from '../lib/format';
import {
  LIA_COPY,
  LIA_LANGUAGES,
  LIA_TOPIC_ORDER,
  describeVillage,
  loadLiaPrefs,
  recentVillageMessages,
  saveLiaPrefs,
  type LiaIconKey,
  type LiaLanguage,
  type LiaTopicId,
} from '../lib/lia';
import { primeVoices, speakText, speechSupported, stopSpeaking, voiceAvailable } from '../lib/speech';
import { useVillage } from '../lib/village';
import { api } from '../lib/api';
import { subscribeOpenLia } from '../lib/liaUi';
import { useApi } from '../lib/useApi';
import { useVoiceUi } from '../lib/voiceUi';
import { LanguagePicker } from './LanguagePicker';
import { LiaAvatar } from './LiaAvatar';
import {
  IconActivity,
  IconBin,
  IconCamera,
  IconClose,
  IconDashboard,
  IconDroplet,
  IconInfo,
  IconLamp,
  IconMic,
  IconPump,
  IconSensors,
  IconSpeaker,
  IconWaste,
  IconWifi,
  type IconProps,
} from './Icons';

type Glyph = (props: IconProps) => ReactElement;

const GLYPHS: Record<LiaIconKey, Glyph> = {
  dashboard: IconDashboard,
  sensor: IconSensors,
  water: IconDroplet,
  light: IconLamp,
  waste: IconWaste,
  voice: IconMic,
  help: IconInfo,
  pump: IconPump,
  camera: IconCamera,
  bin: IconBin,
  connection: IconWifi,
  event: IconActivity,
  tank: IconTank,
};

function IconTank(props: IconProps) {
  const { size = 24, className } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="5" y="3.5" width="14" height="17" rx="3" />
      <path d="M5 14c2-1.5 4-1.5 6 0s4 1.5 6 0" />
      <path d="M5 17.5c2-1.5 4-1.5 6 0s4 1.5 6 0" />
    </svg>
  );
}

function LiaPicture({ icon, size = 64 }: { icon: LiaIconKey; size?: number }) {
  const Glyph = GLYPHS[icon] ?? IconInfo;
  return (
    <span className="lia-figure" style={{ width: size, height: size }} aria-hidden="true">
      <Glyph size={Math.round(size * 0.52)} />
    </span>
  );
}

type LiaView =
  | { kind: 'home' }
  | { kind: 'topic'; id: LiaTopicId; step: number }
  | { kind: 'live' };

export function LiaGuide() {
  const navigate = useNavigate();
  const { openPanel, language, setLanguage: setSharedLanguage } = useVoiceUi();
  const { status, connected, stale, ageMs, demo } = useVillage();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<LiaView>({ kind: 'home' });
  const [speaking, setSpeaking] = useState(false);
  // Whether this visit is being read aloud.  It starts from the preference so
  // opening Lia speaks straight away, and the button keeps it in step.
  const [reading, setReading] = useState(() => loadLiaPrefs().autoRead);
  const [voiceTick, setVoiceTick] = useState(0);
  const [voiceNote, setVoiceNote] = useState('');
  const tts = useApi(['voice-readiness'], () => api.voiceReadiness(), {});

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const copy = LIA_COPY[language];

  const liveItems = useMemo(
    () => describeVillage({ status, connected, stale, ageMs, demo, }, language),
    [status, connected, stale, ageMs, demo, language],
  );
  const messages = useMemo(() => recentVillageMessages(status, language), [status, language]);

  /** Lia has been opened once, so the home page stops asking. */
  const rememberOpened = useCallback(() => {
    const stored = loadLiaPrefs();
    if (stored.dismissed) return;
    saveLiaPrefs({ ...stored, dismissed: true });
  }, []);

  const close = useCallback(() => {
    stopSpeaking();
    setSpeaking(false);
    setOpen(false);
    rememberOpened();
  }, [rememberOpened]);

  const chooseTopic = useCallback(
    (id: LiaTopicId) => {
      rememberOpened();
      setView({ kind: 'topic', id, step: 0 });
      setOpen(true);
    },
    [rememberOpened],
  );

  const openLive = useCallback(() => {
    rememberOpened();
    setView({ kind: 'live' });
    setOpen(true);
  }, [rememberOpened]);

  const go = useCallback(
    (page: string) => {
      navigate(page);
      close();
    },
    [close, navigate],
  );

  const textFor = useCallback(
    (language: LiaLanguage): string => {
      const local = LIA_COPY[language];
      if (view.kind === 'home') return local.welcome;
      if (view.kind === 'live') {
        const items = describeVillage({ status, connected, stale, ageMs, demo }, language);
        return [
          local.liveIntro,
          ...items.map((item) => item.text),
          ...recentVillageMessages(status, language),
        ]
          .filter(Boolean)
          .join(' ');
      }
      const topic = local.topics[view.id];
      const step = topic.steps[view.step];
      if (!step) return topic.intro;
      const last = view.step === topic.steps.length - 1;
      return [
        topic.intro,
        `${step.title}.`,
        step.text,
        topic.adultNote ?? '',
        last ? topic.physical ?? '' : '',
      ]
        .filter(Boolean)
        .join(' ');
    },
    [view, status, connected, stale, ageMs, demo],
  );

  const audioSupported = speechSupported();
  // Piper (the local neural voice) speaks all three languages, so a missing
  // browser voice is only a problem when Piper is not installed either.
  const piperReady = Boolean(tts.data?.tts?.ready);
  // Until the readiness answer arrives, "no voice" is not known — and a button
  // that refuses the first press because a request is still in flight is
  // exactly the "nothing happened" the reader sees.  Attempt, then report.
  const readabilityKnown = tts.data !== undefined;
  // voiceTick re-runs this when Chrome finally publishes its voice list.
  const browserVoice = useMemo(
    () => audioSupported && voiceAvailable(language),
    [audioSupported, language, voiceTick],
  );
  const missingVoice = readabilityKnown && !piperReady && !browserVoice;
  const canSpeak = !missingVoice;

  const labelFor = useCallback(
    (code: string) => LIA_LANGUAGES.find((entry) => entry.code === code)?.label ?? code,
    [],
  );

  const speakNow = useCallback(
    async (code: LiaLanguage = language): Promise<boolean> => {
      const text = textFor(code);
      if (!text) return false;
      // No voice for this language means silence, not a slow browser: say so
      // rather than leaving the button looking broken.
      if (missingVoice) {
        setVoiceNote(copy.voiceMissing(labelFor(code)));
        return false;
      }
      setSpeaking(true);
      setVoiceNote('');
      try {
        const ok = await speakText(text, code, 0.92);
        if (!ok) setVoiceNote(copy.voiceMissing(labelFor(code)));
        return ok;
      } finally {
        setSpeaking(false);
      }
    },
    [textFor, language, missingVoice, labelFor, copy],
  );

  useEffect(() => {
    return subscribeOpenLia((entry) => {
      setOpen(true);
      if (entry === 'model') setView({ kind: 'topic', id: 'around', step: 0 });
      else if (entry === 'voice') setView({ kind: 'topic', id: 'voice', step: 0 });
      else if (entry === 'events') setView({ kind: 'live' });
      else setView({ kind: 'home' });
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      stopSpeaking();
      previous?.focus();
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!speechSupported()) return;
    const handler = () => setVoiceTick((value) => value + 1);
    const synth = window.speechSynthesis;
    synth.addEventListener?.('voiceschanged', handler);
    // Chrome fills the list after mount; without this the first check sees an
    // empty list and calls every language "available".
    void primeVoices().then(() => setVoiceTick((value) => value + 1));
    return () => synth.removeEventListener?.('voiceschanged', handler);
  }, []);

  const viewKey = view.kind === 'topic' ? `topic:${view.id}:${view.step}` : view.kind;
  // The last page actually read, so a re-render (a status refresh, a new voice
  // list) does not start the same sentence again.
  const lastRead = useRef('');

  useEffect(() => {
    if (!open) return;
    // Read the preference when Lia opens rather than when this component
    // mounted: it lives in Settings, which can be changed in another tab of
    // the same visit.
    setReading(loadLiaPrefs().autoRead);
    lastRead.current = '';
  }, [open]);

  useEffect(() => {
    if (!open || !reading) return;
    const key = `${language}|${viewKey}`;
    if (lastRead.current === key) return;
    // A short pause lets the panel paint before the voice starts.
    const timer = window.setTimeout(() => {
      lastRead.current = key;
      void speakNow(language);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [open, reading, language, viewKey, speakNow]);

  const toggleReadAloud = () => {
    if (reading) {
      setReading(false);
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setReading(true);
    // Claim the page so the effect above does not read it twice.
    lastRead.current = `${language}|${viewKey}`;
    void speakNow(language).then((ok) => {
      // A button that stays lit while nothing is heard is the bug being fixed.
      if (!ok) setReading(false);
    });
  };

  const setLanguage = (next: LiaLanguage) => {
    if (next === language) return;
    stopSpeaking();
    setSpeaking(false);
    setSharedLanguage(next);
    // Read-aloud follows the language: the effect above reads the same page in
    // the newly chosen language and leaves the button on.
  };

  const renderHome = () => (
    <>
      <p className="lia-welcome">{copy.welcome}</p>
      <p className="lia-child-note">{copy.childNote}</p>
      <div className="lia-quick">
        <button type="button" className="lia-quick-choice" onClick={() => chooseTopic('around')} data-testid="lia-quick-model">
          <LiaPicture icon="dashboard" size={44} />
          <span>{copy.quickModel}</span>
        </button>
        <button type="button" className="lia-quick-choice" onClick={() => chooseTopic('voice')} data-testid="lia-quick-voice">
          <LiaPicture icon="voice" size={44} />
          <span>{copy.quickVoice}</span>
        </button>
        <button type="button" className="lia-quick-choice" onClick={openLive} data-testid="lia-quick-events">
          <LiaPicture icon="event" size={44} />
          <span>{copy.quickEvents}</span>
        </button>
      </div>
      <details className="lia-more">
        <summary>{copy.moreTopics}</summary>
        <div className="lia-topics">
          {LIA_TOPIC_ORDER.map((id) => {
            const topic = copy.topics[id];
            return (
              <button
                key={id}
                type="button"
                className="lia-topic"
                onClick={() => chooseTopic(id)}
                data-testid={`lia-topic-${id}`}
              >
                <LiaPicture icon={topic.icon} size={44} />
                <span className="lia-topic-copy">
                  <span className="lia-topic-label">{topic.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      </details>
      <div className="lia-foot">
        <button
          type="button"
          className="btn btn--gold"
          onClick={() => {
            close();
            openPanel();
          }}
          data-testid="lia-start-speaking"
        >
          <IconMic size={16} /> {copy.startSpeaking}
        </button>
        <button type="button" className="btn btn--ghost" onClick={close}>
          {copy.maybeLater}
        </button>
      </div>
    </>
  );

  const renderTopic = (id: LiaTopicId, stepIndex: number) => {
    const topic = copy.topics[id];
    const step = topic.steps[stepIndex];
    if (!step) return null;
    const last = stepIndex === topic.steps.length - 1;
    return (
      <>
        <button type="button" className="lia-back" onClick={() => setView({ kind: 'home' })}>
          ← {copy.back}
        </button>
        <div className="lia-topic-head">
          <LiaPicture icon={topic.icon} size={64} />
          <div>
            <h3 className="lia-heading">{topic.label}</h3>
            <p className="lia-subtle">{topic.intro}</p>
          </div>
        </div>
        {topic.adult && (
          <div className="lia-adult">
            <IconInfo size={18} />
            <div>
              <strong>{copy.adultLabel}</strong>
              <p>{topic.adultNote}</p>
            </div>
          </div>
        )}
        <div className="lia-progress" aria-hidden="true">
          {topic.steps.map((_, index) => (
            <span
              key={index}
              className={cx('lia-dot', index === stepIndex && 'is-on', index < stepIndex && 'is-done')}
            />
          ))}
        </div>
        <div className="lia-step" aria-live="polite">
          <LiaPicture icon={step.icon} size={88} />
          <div className="lia-step-copy">
            <p className="lia-step-count">{copy.stepOf(stepIndex + 1, topic.steps.length)}</p>
            <h3 className="lia-heading">{step.title}</h3>
            <p className="lia-step-text">{step.text}</p>
            {step.page && (
              <button type="button" className="btn btn--primary" onClick={() => go(step.page as string)}>
                {copy.openPage}
              </button>
            )}
          </div>
        </div>
        {last && topic.physical && (
          <div className="lia-physical">
            <IconSparkle />
            <p>{topic.physical}</p>
          </div>
        )}
        <div className="lia-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setView({ kind: 'topic', id, step: Math.max(0, stepIndex - 1) })}
            disabled={stepIndex === 0}
          >
            {copy.previous}
          </button>
          {last ? (
            <button type="button" className="btn btn--gold" onClick={() => setView({ kind: 'home' })}>
              {copy.done}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--gold"
              onClick={() => setView({ kind: 'topic', id, step: stepIndex + 1 })}
            >
              {copy.next}
            </button>
          )}
        </div>
        <div className="lia-foot">
          <button type="button" className="btn btn--ghost" onClick={close}>
            {copy.close}
          </button>
        </div>
      </>
    );
  };

  const renderLive = () => (
    <>
      <button type="button" className="lia-back" onClick={() => setView({ kind: 'home' })}>
        ← {copy.back}
      </button>
      <h3 className="lia-heading">{copy.liveTitle}</h3>
      <p className="lia-subtle">{copy.liveIntro}</p>
      <ul className="lia-live">
        {liveItems.map((item, index) => (
          <li key={`${item.icon}-${index}`}>
            <LiaPicture icon={item.icon} size={40} />
            <p>{item.text}</p>
          </li>
        ))}
      </ul>
      {!connected && <p className="lia-note">{copy.offlineHint}</p>}
      <div className="lia-events">
        <p className="eyebrow">{copy.lastEventLabel}</p>
        {messages.length > 0 ? (
          messages.map((message, index) => (
            <p key={index} className="lia-event-line">
              {message}
            </p>
          ))
        ) : (
          <p className="lia-subtle">{copy.noEvents}</p>
        )}
      </div>
      <div className="lia-actions">
        <button type="button" className="btn" onClick={() => speakNow()} disabled={!canSpeak}>
          <IconSpeaker size={16} /> {copy.refresh}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => go('/activity')}>
          {copy.viewDiary}
        </button>
      </div>
      <div className="lia-foot">
        <button type="button" className="btn btn--ghost" onClick={close}>
          {copy.close}
        </button>
      </div>
    </>
  );

  return (
    <>
      {open && (
        <div
          className="lia-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            className="lia-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lia-dialog-title"
            tabIndex={-1}
            ref={dialogRef}
            data-testid="lia-guide"
          >
            <header className="lia-head">
              <LiaAvatar size={66} />
              <div className="lia-head-copy">
                <p className="lia-name" id="lia-dialog-title">
                  Lia
                </p>
                <p className="lia-role">{copy.role}</p>
              </div>
              <button
                type="button"
                className="icon-btn lia-close"
                onClick={close}
                aria-label={copy.close}
              >
                <IconClose size={18} />
              </button>
            </header>

            <div className="lia-toolbar">
              <LanguagePicker
                options={LIA_LANGUAGES.map((entry) => ({ code: entry.code, label: entry.label }))}
                value={language}
                onChange={(code) => setLanguage(code as LiaLanguage)}
                label="Language"
                testId="lia-lang"
                className="lia-langs"
              />
              <button
                type="button"
                className={cx('lia-read', reading && 'is-on', speaking && 'is-speaking')}
                aria-pressed={reading}
                aria-busy={speaking}
                onClick={toggleReadAloud}
                disabled={!canSpeak}
                title={
                  !canSpeak
                    ? audioSupported
                      ? copy.voiceMissing(labelFor(language))
                      : copy.speechUnavailable
                    : copy.readAloud
                }
                data-testid="lia-read-aloud"
              >
                <IconSpeaker size={16} /> {copy.readAloud}
              </button>
            </div>

            {!canSpeak && (
              <p className="lia-note">
                {audioSupported ? copy.voiceMissing(labelFor(language)) : copy.speechUnavailable}
              </p>
            )}
            {canSpeak && voiceNote && <p className="lia-note">{voiceNote}</p>}

            {view.kind === 'home' && renderHome()}
            {view.kind === 'topic' && renderTopic(view.id, view.step)}
            {view.kind === 'live' && renderLive()}
          </div>
        </div>
      )}
    </>
  );
}

function IconSparkle() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.2l1.9 4.7L18.6 9.8l-4.7 1.9L12 16.4l-1.9-4.7L5.4 9.8l4.7-1.9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="18.5" cy="17.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

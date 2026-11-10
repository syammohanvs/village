import { useEffect, useRef, useState } from 'react';
import type { CommandOutcome } from '../lib/commands';
import { useCommands } from '../lib/commands';
import { useDemo } from '../lib/demo';
import { ApiError, api, errorMessage } from '../lib/api';
import { VoiceRecorder, recordingSupported } from '../lib/audio';
import { useApi } from '../lib/useApi';
import { speakReply, speechSupported, stopSpeaking } from '../lib/speech';
import { useVillage } from '../lib/village';
import { describeVillage } from '../lib/lia';
import { VOICE_LANGUAGES, useVoiceUi, type VoiceLanguage } from '../lib/voiceUi';
import { cx } from '../lib/format';
import type { VoiceIntent, VoiceIntentsResponse, VoiceTranscribeResponse } from '../types';
import { IconClose, IconMic, IconPlug, IconSpeaker, IconSparkle } from './Icons';
import { LanguagePicker } from './LanguagePicker';
import { VOICE_EXAMPLES, VOICE_LANGUAGE_NAMES } from '../lib/voiceExamples';

const ALLOWED_COMMANDS = new Set([
  'LIGHTS_ON',
  'LIGHTS_OFF',
  'LIGHTS_AUTO',
  'IRRIGATION_REQUEST',
  'IRRIGATION_STOP',
]);

const INTENT_COMMAND: Record<string, string> = {
  LIGHTS_ON: 'LIGHTS_ON',
  LIGHTS_OFF: 'LIGHTS_OFF',
  LIGHTS_AUTO: 'LIGHTS_AUTO',
  IRRIGATION_START: 'IRRIGATION_REQUEST',
  IRRIGATION_STOP: 'IRRIGATION_STOP',
};

const BLOCKED_INTENTS = new Set(['UNKNOWN', 'NEGATED', 'AMBIGUOUS', 'NO_SPEECH']);
const BLOCKED_STATUS = new Set(['unknown', 'negated', 'ambiguous', 'no_speech', 'no-speech']);

const MAX_SECONDS = 10;

type VoiceState = 'idle' | 'listening' | 'processing' | 'success' | 'rejected' | 'disconnected';

function intentLabel(intent: VoiceIntent, language: string): string {
  if (typeof intent.label === 'string') return intent.label;
  return intent.label[language] ?? intent.label.en ?? intent.id;
}

function intentPhrases(intent: VoiceIntent, language: string): string[] {
  if (!intent.phrases) return [];
  if (Array.isArray(intent.phrases)) return intent.phrases;
  return intent.phrases[language] ?? intent.phrases.en ?? [];
}

function orderedIntents(data: VoiceIntentsResponse | null): VoiceIntent[] {
  const intents = data?.intents ?? [];
  const order = data?.help_order ?? [];
  if (order.length === 0) return intents;
  const index = new Map(order.map((id, position) => [id, position]));
  return [...intents].sort((a, b) => {
    const left = index.get(a.id) ?? 99;
    const right = index.get(b.id) ?? 99;
    return left - right;
  });
}

export function VoicePanel() {
  const { open, closePanel, language, setLanguage } = useVoiceUi();
  const { demo } = useDemo();
  const { send } = useCommands();
  // `status` is also a local name inside finish() (the intent status), so the
  // frame is read as villageStatus here.
  const {
    status: villageStatus,
    connected,
    stale,
    ageMs,
    demo: villageDemo,
    loading: villageLoading,
  } = useVillage();

  const [state, setState] = useState<VoiceState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState('');
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<VoiceTranscribeResponse | null>(null);
  const [outcome, setOutcome] = useState<CommandOutcome | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [ttsNote, setTtsNote] = useState('');
  const [micError, setMicError] = useState('');

  const panelRef = useRef<HTMLElement | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(0);
  const speakingRef = useRef(false);

  const intents = useApi<VoiceIntentsResponse>(
    ['voice-intents', language],
    () => api.voiceIntents(language),
    { enabled: open },
  );
  const readiness = useApi(['voice-readiness'], () => api.voiceReadiness(), { enabled: open });
  const settings = useApi(['settings'], () => api.settings(), { enabled: open });

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTimer();
      recorderRef.current?.cancel();
      recorderRef.current = null;
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open, closePanel]);

  useEffect(() => {
    if (!open) {
      clearTimer();
      recorderRef.current?.cancel();
      recorderRef.current = null;
      stopSpeaking();
      speakingRef.current = false;
      setSpeaking(false);
      setState('idle');
      setElapsed(0);
    }
  }, [open]);

  const speak = async (text: string, intent: string | null) => {
    if (!text || speakingRef.current) return;
    if (settings.data && settings.data.tts_enabled === false) return;
    speakingRef.current = true;
    setSpeaking(true);
    setTtsNote('');
    try {
      const how = await speakReply(text, language, intent);
      if (how === 'none') {
        setTtsNote('Spoken replies are unavailable in this browser. The text above is the full reply.');
      }
    } finally {
      speakingRef.current = false;
      setSpeaking(false);
    }
  };

  async function start() {
    if (state === 'listening' || state === 'processing' || speaking) return;
    setMicError('');
    setMessage('');
    setTranscript('');
    setResult(null);
    setOutcome(null);
    setTtsNote('');
    try {
      const recorder = new VoiceRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      setElapsed(0);
      setState('listening');
      clearTimer();
      timerRef.current = setInterval(() => {
        const seconds = (Date.now() - startedRef.current) / 1000;
        setElapsed(seconds);
        if (seconds >= MAX_SECONDS) {
          void finish();
        }
      }, 100);
    } catch (cause) {
      setState('idle');
      setMicError(
        cause instanceof Error
          ? `The microphone could not start: ${cause.message}`
          : 'The microphone could not start.',
      );
    }
  }

  async function finish() {
    clearTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;
    setState('processing');
    let blob: Blob;
    try {
      blob = await recorder.stop();
    } catch (cause) {
      setState('idle');
      setMicError(errorMessage(cause));
      return;
    }
    if (!blob || blob.size === 0) {
      setState('rejected');
      setMessage('No speech was detected. Press Start Speaking again and speak clearly.');
      return;
    }

    try {
      const response = await api.voiceTranscribe(blob, language);
      setResult(response);
      const text = response.text ?? response.transcript ?? '';
      setTranscript(text);
      const status = (response.status ?? '').toLowerCase();
      const intent = response.intent ?? null;
      const blocked =
        BLOCKED_STATUS.has(status) ||
        (intent ? BLOCKED_INTENTS.has(intent.toUpperCase()) : false);

      if (blocked) {
        setState('rejected');
        const reply =
          response.message ??
          'Please use one of the commands shown, or ask the presenter for help. No command was sent.';
        setMessage(reply);
        void speak(reply, intent);
        return;
      }

      const command = response.command ?? (intent ? INTENT_COMMAND[intent] ?? null : null);
      const canAct = Boolean(command && ALLOWED_COMMANDS.has(command) && response.actuation !== false);

      if (!canAct) {
        setState('success');
        // The catalogue carries the answer in `response_text`; `message` is
        // only set for a refusal.  Reading `message` alone threw every
        // answer-only reply away, which is why "village status" looked inert.
        let reply =
          response.response_text ??
          response.message ??
          'That one does not move anything. It only answers.';
        // A status question is better answered from the frame on screen than
        // from a canned sentence: this reads the current soil, water, light
        // and pump state aloud in the selected language.
        if (intent === 'VILLAGE_STATUS' && villageStatus) {
          const live = describeVillage(
            { status: villageStatus, connected, stale, ageMs, demo: villageDemo },
            language as 'en' | 'ml' | 'hi',
          )
            .map((item) => item.text)
            .join(' ');
          if (live) reply = live;
        }
        setMessage(reply);
        void speak(reply, intent);
        return;
      }

      setState('success');
      setMessage(
        response.pending_text ??
          response.message ??
          'Command understood. Sending it to the village controller.',
      );
      const commandOutcome = await send(command as string, {}, 'voice');
      setOutcome(commandOutcome);
      if (commandOutcome.status === 'rejected') {
        setState('rejected');
        setMessage(
          commandOutcome.reason ??
            'The controller received the command and refused it. Nothing changed.',
        );
      } else if (commandOutcome.status === 'unconfirmed') {
        setState('disconnected');
        setMessage(
          commandOutcome.reason ??
            'The controller did not acknowledge the command. Do not assume anything happened.',
        );
      } else if (commandOutcome.status === 'duplicate') {
        setMessage(
          commandOutcome.reason ?? 'This command was already processed. The original decision stands.',
        );
      }
      const done =
        commandOutcome.status === 'confirmed'
          ? response.done_text || response.response_text
          : undefined;
      void speak(
        commandOutcome.reason ?? done ?? response.message ?? 'Command sent.',
        intent,
      );
    } catch (cause) {
      const apiError = cause instanceof ApiError ? cause : null;
      const unreachable = apiError ? apiError.status === 0 || apiError.status === 503 : true;
      setState(unreachable ? 'disconnected' : 'rejected');
      setMessage(
        unreachable
          ? 'The village service did not answer. No command was sent. Is the laptop backend running?'
          : errorMessage(cause),
      );
    }
  }

  const micSupported = recordingSupported();
  const speechState: 'checking' | 'ready' | 'off' | 'unknown' = readiness.error
    ? 'unknown'
    : readiness.loading
      ? 'checking'
      : readiness.data?.whisper?.ready === false
        ? 'off'
        : 'ready';

  const blocker = !micSupported
    ? 'This browser cannot record audio, so spoken commands are unavailable here. Use the buttons on the cards instead.'
    : !connected
      ? 'The board is disconnected, so a spoken command cannot be carried out. Reconnect the board and try again.'
      : speechState === 'off'
        ? `The speech service is not available on this laptop: ${readiness.data?.whisper?.message ?? 'the local model is missing.'}`
        : speechState === 'unknown'
          ? 'The speech service could not be checked, so recording is paused. The cards still work.'
          : '';

  const supported = micSupported && connected && speechState !== 'off' && speechState !== 'unknown';
  const disabled = speaking || state === 'processing' || !supported;
  const helpIntents = orderedIntents(intents.data);
  const unavailable = new Set(readiness.data?.unavailable_languages ?? []);
  // Prose uses the English name (the pills already show each language naming
  // itself), so a sentence does not switch script halfway through.
  const languageLabel = VOICE_LANGUAGE_NAMES[language] ?? 'English';
  const examples = VOICE_EXAMPLES[language] ?? VOICE_EXAMPLES.en;
  // Four phrases fit beside the microphone on a 768 px laptop; the rest are a
  // folded list rather than a scrollbar inside a panel.
  const visibleIntents = helpIntents.slice(0, 4);
  const moreIntents = helpIntents.slice(4);

  if (!open) return null;

  return (
    <section
      className="voice-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Voice command"
      tabIndex={-1}
      ref={panelRef}
      data-testid="voice-panel"
    >
      <header className="voice-head">
        <div className="voice-title-block">
          <span className="voice-emblem" aria-hidden="true">
            <IconMic size={18} />
          </span>
          <div>
            <h2 className="voice-title">Talk to the village</h2>
            <p className="voice-subtitle">
              Say one short command in {languageLabel}. Speech is recognised on this laptop.
            </p>
          </div>
        </div>
        <button
          className="icon-btn"
          type="button"
          onClick={closePanel}
          aria-label="Close voice panel"
        >
          <IconClose size={18} />
        </button>
      </header>

      <div className="voice-readiness" data-testid="voice-readiness">
        <span
          className={cx(
            'chip',
            demo
              ? 'chip--warn'
              : blocker
                ? 'chip--bad'
                : speechState === 'checking'
                  ? 'chip--neutral'
                  : 'chip--live',
          )}
        >
          {demo
            ? 'Simulation'
            : !micSupported
              ? 'No microphone'
              : !connected
                ? 'Board offline'
                : speechState === 'checking'
                  ? 'Checking speech…'
                  : speechState === 'unknown'
                    ? 'Speech not checked'
                    : speechState === 'off'
                      ? 'Speech service unavailable'
                      : 'Speech ready'}
        </span>
        {blocker && <p className="voice-blocker">{blocker}</p>}
        {!blocker && villageLoading && (
          <p className="voice-blocker">Waiting for the first reading from the board…</p>
        )}
      </div>

      <LanguagePicker
        options={VOICE_LANGUAGES.map((entry) => ({
          code: entry.code,
          label: entry.label,
          note: unavailable.has(entry.code) ? 'understood, not spoken' : undefined,
        }))}
        value={language}
        onChange={(code) => setLanguage(code as VoiceLanguage)}
        label="Spoken language"
        disabled={state === 'listening' || state === 'processing'}
        testId="voice-lang"
      />

      <div className={cx('voice-stage', state === 'listening' && 'is-listening')}>
        <button
          type="button"
          className={cx('ptt', state === 'listening' && 'is-live')}
          onClick={() => {
            if (state === 'listening') void finish();
            else void start();
          }}
          disabled={disabled && state !== 'listening'}
          aria-label={state === 'listening' ? 'Stop Recording' : 'Start Speaking'}
          data-testid="voice-start"
        >
          <span className="ptt-icon" aria-hidden="true">
            {state === 'listening' ? (
              <IconPlug size={24} />
            ) : speaking ? (
              <IconSpeaker size={24} />
            ) : (
              <IconMic size={24} />
            )}
          </span>
          <span className="ptt-copy">
            <span className="ptt-label">
              {state === 'listening'
                ? 'Stop Recording'
                : speaking
                  ? 'Playing the reply…'
                  : 'Start Speaking'}
            </span>
            <span className="ptt-hint">
              {state === 'listening'
                ? `${elapsed.toFixed(1)}s of ${MAX_SECONDS}s — press to finish`
                : `Up to ${MAX_SECONDS} seconds, then it stops by itself.`}
            </span>
          </span>
        </button>

        <div className="voice-state" aria-live="polite">
          {state === 'listening' && (
            <p className="voice-listening">
              <span className="wave" aria-hidden="true">
                <i /> <i /> <i /> <i />
              </span>
              Listening — speak one short command.
            </p>
          )}
          {state === 'processing' && <p>Understanding your words…</p>}
          {micError && <p className="error-text">{micError}</p>}
          {ttsNote && <p className="hint">{ttsNote}</p>}
        </div>
      </div>

      {transcript && (
        <div className="voice-transcript">
          <p className="eyebrow">You said</p>
          <p className="voice-heard">“{transcript}”</p>
        </div>
      )}

      {result && (
        <div className="voice-result">
          <div className="voice-result-row">
            <span className="eyebrow">Intent</span>
            <span className="chip chip--neutral">
              {result.intent ?? 'not matched'}
              {typeof result.confidence === 'number' && ` · ${Math.round(result.confidence * 100)}%`}
            </span>
            {result.command && <span className="chip chip--gold">command: {result.command}</span>}
          </div>
          {message && (
            <p className={cx('voice-message', state === 'rejected' && 'is-rejected')}>{message}</p>
          )}
          {outcome && (
            <p
              className={cx(
                'voice-outcome',
                outcome.status === 'confirmed' && 'is-ok',
                outcome.status === 'rejected' && 'is-rejected',
                outcome.status === 'unconfirmed' && 'is-warn',
              )}
              data-testid="voice-command-outcome"
            >
              Command {outcome.status}
              {outcome.reasonCode ? ` · ${outcome.reasonCode}` : ''}
              {outcome.reason ? ` — ${outcome.reason}` : ''}
            </p>
          )}
        </div>
      )}

      <div className="voice-help">
        <div className="voice-help-head">
          <div>
            <p className="eyebrow">Say one of these</p>
            <p className="voice-help-note">
              {helpIntents.length > 0
                ? `${helpIntents.length} commands are understood in ${languageLabel}.`
                : `Example commands in ${languageLabel}.`}
            </p>
          </div>
        </div>
        {helpIntents.length > 0 ? (
          <>
            <ul>
              {visibleIntents.map((intent) => (
                <li key={intent.id}>
                  <span className="help-label">{intentLabel(intent, language)}</span>
                  <span className="help-phrase">
                    {intentPhrases(intent, language)[0]
                      ? `“${intentPhrases(intent, language)[0]}”`
                      : intent.id}
                    {intent.command ? <em> · sends {intent.command}</em> : <em> · answer only</em>}
                  </span>
                </li>
              ))}
            </ul>
            {moreIntents.length > 0 && (
              <details className="voice-more">
                <summary>More phrases ({moreIntents.length})</summary>
                <ul>
                  {moreIntents.map((intent) => (
                    <li key={intent.id}>
                      <span className="help-label">{intentLabel(intent, language)}</span>
                      <span className="help-phrase">
                        {intentPhrases(intent, language)[0]
                          ? `“${intentPhrases(intent, language)[0]}”`
                          : intent.id}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <ul>
            {examples.map((example) => (
              <li key={example.label}>
                <span className="help-label">{example.label}</span>
                <span className="help-phrase">“{example.phrase}”</span>
              </li>
            ))}
          </ul>
        )}
        {helpIntents.length === 0 && (
          <p className="hint">
            The full phrase list needs the local service. These examples are the words the parser
            accepts, so they work when it returns.
          </p>
        )}
      </div>

      <footer className="voice-foot">
        <IconSparkle size={15} />
        <span>
          Speech recognition runs on this laptop. Spoken replies use this browser&apos;s own voice
          {speechSupported() ? '' : ' (not available here, so replies are text only)'}.
        </span>
      </footer>
    </section>
  );
}

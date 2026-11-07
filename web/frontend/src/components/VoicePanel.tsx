import { useEffect, useRef, useState } from 'react';
import type { CommandOutcome } from '../lib/commands';
import { useCommands } from '../lib/commands';
import { useDemo } from '../lib/demo';
import { ApiError, api, errorMessage } from '../lib/api';
import { VoiceRecorder, recordingSupported } from '../lib/audio';
import { useApi } from '../lib/useApi';
import { speakReply, speechSupported, stopSpeaking } from '../lib/speech';
import { useVillage } from '../lib/village';
import { useVoiceUi } from '../lib/voiceUi';
import { cx } from '../lib/format';
import type { VoiceIntent, VoiceIntentsResponse, VoiceTranscribeResponse } from '../types';
import { IconClose, IconMic, IconPlug, IconSpeaker, IconSparkle } from './Icons';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'hi', label: 'हिन्दी' },
] as const;

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
  const { open, closePanel, openPanel } = useVoiceUi();
  const { demo } = useDemo();
  const { send } = useCommands();
  const { connected } = useVillage();

  const [language, setLanguage] = useState<string>('en');
  const [state, setState] = useState<VoiceState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState('');
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<VoiceTranscribeResponse | null>(null);
  const [outcome, setOutcome] = useState<CommandOutcome | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [ttsNote, setTtsNote] = useState('');
  const [micError, setMicError] = useState('');

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
      setMessage('No speech was detected. Press start again and speak clearly.');
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
          'That sounded like an unsupported, negated or unclear request. No command was sent.';
        setMessage(reply);
        void speak(reply, intent);
        return;
      }

      const command = response.command ?? (intent ? INTENT_COMMAND[intent] ?? null : null);
      const canAct = Boolean(command && ALLOWED_COMMANDS.has(command) && response.actuation !== false);

      if (!canAct) {
        setState('success');
        const reply =
          response.message ?? 'Status request understood. This one does not move anything.';
        setMessage(reply);
        void speak(reply, intent);
        return;
      }

      setState('success');
      setMessage(response.message ?? 'Command understood. Sending it to the village controller.');
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
      void speak(commandOutcome.reason ?? response.message ?? 'Command sent.', intent);
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

  const supported = recordingSupported() && connected;
  const disabled = speaking || state === 'processing' || !supported;
  const helpIntents = orderedIntents(intents.data);
  const unavailable = new Set(readiness.data?.unavailable_languages ?? []);

  if (!open) {
    return (
      <button className="voice-launcher" type="button" onClick={openPanel}>
        <IconMic size={22} />
        <span>Voice</span>
      </button>
    );
  }

  return (
    <section
      className="voice-panel"
      role="dialog"
      aria-label="Voice command"
      data-testid="voice-panel"
    >
      <header className="voice-head">
        <div className="voice-head-title">
          <span className="voice-emblem">
            <IconMic size={20} />
          </span>
          <div>
            <p className="eyebrow">Push to talk</p>
            <h2>Voice command</h2>
          </div>
        </div>
        <div className="voice-head-actions">
          <span className={cx('chip', demo ? 'chip--warn' : 'chip--gold')}>
            {demo ? 'Demo' : 'Live'}
          </span>
          <button className="icon-btn" type="button" onClick={closePanel} aria-label="Close voice panel">
            <IconClose size={18} />
          </button>
        </div>
      </header>

      <div className="voice-langs" role="group" aria-label="Spoken language">
        {LANGUAGES.map((entry) => (
          <button
            key={entry.code}
            type="button"
            className={cx('segment', language === entry.code && 'is-active')}
            aria-pressed={language === entry.code}
            onClick={() => setLanguage(entry.code)}
            disabled={state === 'listening' || state === 'processing'}
          >
            {entry.label}
            {unavailable.has(entry.code) && <span className="lang-note">text only</span>}
          </button>
        ))}
      </div>

      <div className={cx('voice-stage', state === 'listening' && 'is-listening')}>
        <button
          type="button"
          className={cx('ptt', state === 'listening' && 'is-live')}
          onClick={() => {
            if (state === 'listening') void finish();
            else void start();
          }}
          disabled={disabled && state !== 'listening'}
          aria-label={state === 'listening' ? 'Stop recording and send' : 'Start recording'}
        >
          <span className="ptt-ring" />
          {state === 'listening' ? (
            <>
              <IconPlug size={26} />
              <span>Stop &amp; send · {Math.max(0, Math.ceil(MAX_SECONDS - elapsed))}s</span>
            </>
          ) : speaking ? (
            <>
              <IconSpeaker size={26} />
              <span>Playing the reply…</span>
            </>
          ) : (
            <>
              <IconMic size={26} />
              <span>Start listening</span>
            </>
          )}
        </button>

        <div className="voice-state" aria-live="polite">
          {state === 'idle' && !micError && (
            <p>
              Press start, speak one short command, then press stop. Recordings stop automatically
              after {MAX_SECONDS} seconds. {supported ? '' : 'Microphone access is unavailable here.'}
            </p>
          )}
          {state === 'listening' && (
            <p className="voice-listening">
              <span className="wave" aria-hidden="true">
                <i /> <i /> <i /> <i />
              </span>
              Listening — {elapsed.toFixed(1)}s of {MAX_SECONDS}s
            </p>
          )}
          {state === 'processing' && <p>Converting to 16 kHz mono WAV and asking the local recogniser…</p>}
          {micError && <p className="error-text">{micError}</p>}
          {ttsNote && <p className="hint">{ttsNote}</p>}
        </div>
      </div>

      {transcript && (
        <div className="voice-transcript">
          <p className="eyebrow">Heard</p>
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
          <p className="eyebrow">Say one of these</p>
          <span className="hint">{intents.data?.intents?.length ?? 0} recognised phrases</span>
        </div>
        <ul>
          {helpIntents.slice(0, 10).map((intent) => {
            const phrases = intentPhrases(intent, language);
            return (
              <li key={intent.id}>
                <span className="help-label">{intentLabel(intent, language)}</span>
                <span className="help-phrase">
                  {phrases[0] ? `“${phrases[0]}”` : intent.id}
                  {intent.command ? <em> · sends {intent.command}</em> : <em> · answer only</em>}
                </span>
              </li>
            );
          })}
        </ul>
        {!intents.loading && helpIntents.length === 0 && (
          <p className="hint">Phrase help is unavailable right now.</p>
        )}
        {readiness.data?.whisper && readiness.data.whisper.ready === false && (
          <p className="notice notice--warn">
            Speech recognition is not ready: {readiness.data.whisper.message ?? 'the local model is missing.'}
          </p>
        )}
      </div>

      <footer className="voice-foot">
        <IconSparkle size={15} />
        <span>
          Recognition runs on this laptop. {speechSupported() ? '' : 'Spoken replies need a browser with speech synthesis.'}
        </span>
      </footer>
    </section>
  );
}

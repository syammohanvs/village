import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CommandOutcome } from '../lib/commands';
import { useCommands } from '../lib/commands';
import { useDemo } from '../lib/demo';
import { ApiError, api, errorMessage } from '../lib/api';
import { VoiceRecorder, recordingSupported } from '../lib/audio';
import { useApi } from '../lib/useApi';
import { speakReply, speechSupported, stopSpeaking, voiceAvailable } from '../lib/speech';
import { useVillage } from '../lib/village';
import { LIVE_COPY, VOICE_GREETING, describeVillage, inScript } from '../lib/lia';
import { VOICE_LANGUAGES, useVoiceUi, type VoiceLanguage } from '../lib/voiceUi';
import { cx } from '../lib/format';
import type { DeviceStatus, VoiceIntent, VoiceIntentsResponse, VoiceTranscribeResponse } from '../types';
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


const NO_ACTION_INTENTS = new Set(['UNKNOWN', 'NEGATED', 'AMBIGUOUS', 'NO_SPEECH', 'STATEMENT', 'HYPOTHETICAL']);
const NO_ACTION_STATUS = new Set(['unknown', 'negated', 'ambiguous', 'no_speech', 'no-speech',
  'statement', 'hypothetical']);

/** Older payloads had no `kind`; derive it so both shapes behave the same. */
function kindOf(response: VoiceTranscribeResponse): string {
  if (response.kind) return response.kind;
  const intent = (response.intent ?? '').toUpperCase();
  const status = (response.status ?? '').toLowerCase();
  if (intent === 'NEGATED' || status === 'negated') return 'negated';
  if (intent === 'AMBIGUOUS' || status === 'ambiguous') return 'ambiguous';
  if (intent === 'NO_SPEECH' || NO_ACTION_STATUS.has(status)) return 'no_speech';
  if (intent === 'STATEMENT' || status === 'statement') return 'statement';
  if (intent === 'HYPOTHETICAL' || status === 'hypothetical') return 'hypothetical';
  if (intent === 'UNKNOWN' || status === 'unknown') return 'unsupported';
  if (NO_ACTION_INTENTS.has(intent) && !response.command) return 'status';
  return response.command ? 'command' : 'status';
}

/** True when the controller already reports the state the command asks for. */
function alreadyInState(command: string, status: DeviceStatus | null): boolean {
  const lights = status?.actuators?.streetlights;
  const irrigation = status?.irrigation;
  switch (command) {
    // "Already off" has to mean the lamps are HELD off, not merely off because
    // it is bright and Auto is in charge: in Auto a "lights off" that is
    // swallowed leaves the LDR free to switch them on at dusk, which is not
    // what the visitor asked for.  Same the other way round at night.
    case 'LIGHTS_OFF':
      return lights?.mode === 'manual_off';
    case 'LIGHTS_ON':
      return lights?.mode === 'manual_on';
    case 'LIGHTS_AUTO':
      return lights?.mode === 'auto';
    case 'IRRIGATION_REQUEST':
      return irrigation?.state === 'pumping' || irrigation?.state === 'soaking';
    case 'IRRIGATION_STOP':
      return irrigation?.state === 'idle';
    default:
      return false;
  }
}

/**
 * One stable id per utterance.  A repeated event (a double press, a duplicated
 * transcription callback, a double submit) therefore becomes the controller's
 * DUPLICATE answer instead of a second physical command.
 */
function utteranceId(text: string, stamp: number): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return `voice-${hash.toString(16)}-${Math.floor(stamp).toString(36)}`;
}

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
  // A completed utterance is processed once: these guard the double press, a
  // duplicated transcription event and a double submit of typed text.
  const finishingRef = useRef(false);
  const typedBusyRef = useRef(false);
  // The id of the words currently in the box.  A retry of the same submission
  // reuses it, so the controller answers DUPLICATE instead of acting twice; the
  // box is cleared on a successful send, so a later deliberate repetition gets
  // a new id and really does run.
  const typedGestureRef = useRef<{ text: string; id: string } | null>(null);
  const [typed, setTyped] = useState('');

  const intents = useApi<VoiceIntentsResponse>(
    ['voice-intents', language],
    () => api.voiceIntents(language),
    { enabled: open },
  );
  // Polled while the panel is open: the local speech server is a separate
  // process, and starting it later must bring the microphone back without a
  // reload -- otherwise "it is not listening" survives a perfectly good fix.
  const readiness = useApi(['voice-readiness'], () => api.voiceReadiness(), {
    enabled: open,
    intervalMs: 15000,
  });
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
        const ttsReady = Boolean(readiness.data?.tts?.ready);
        setTtsNote(
          !ttsReady && speechSupported() && !voiceAvailable(language)
            ? `This computer has no ${VOICE_LANGUAGE_NAMES[language] ?? language} voice, so the reply is shown as text.`
            : 'The reply could not be read aloud. The text above is the full reply.',
        );
      }
    } finally {
      speakingRef.current = false;
      setSpeaking(false);
    }
  };

  // The greeting must not re-run when a reply changes state; the ref holds the
  // newest speak() so the effect below depends on `open` and `language` only.
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const greetedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      greetedRef.current = false;
      return;
    }
    if (greetedRef.current) return;
    // Wait for the preference before speaking: a greeting that ignores "do not
    // read aloud" because the settings had not arrived yet is a voice nobody
    // asked for.
    if (!settings.data) return;
    greetedRef.current = true;
    if (settings.data.tts_enabled === false) return;
    // "I am Sara. How may I help you?" in the language chosen on the page.
    // Silence if this laptop has no voice; the greeting is a courtesy, never a
    // reason to show an error over the command box.
    if (!speechSupported()) return;
    void speakRef
      .current(VOICE_GREETING[language] ?? VOICE_GREETING.en, null)
      .catch(() => undefined);
  }, [open, language, settings.data]);

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

  /**
   * The one path from an understood sentence to a reply.  Speech (after
   * Whisper) and typed text both arrive here, so they cannot behave
   * differently.  Only `kind === 'command'` can reach the controller.
   */
  async function applyUtterance(
    response: VoiceTranscribeResponse,
    transcript: string,
    requestId: string,
  ) {
    const kind = kindOf(response);
    const intent = response.intent ?? null;
    setResult(response);
    setTranscript(transcript);

    if (kind === 'no_speech') {
      setState('rejected');
      const reply = response.message ?? 'No speech was detected. Press Start Speaking again and speak clearly.';
      setMessage(reply);
      void speak(reply, intent);
      return;
    }

    if (kind !== 'command') {
      let reply =
        response.message ??
        response.response_text ??
        'That one does not move anything. It only answers.';
      // A status question is answered from the frame on screen, in the selected
      // language, rather than from a canned sentence.
      if (kind === 'status' && villageStatus) {
        const copy = LIVE_COPY[language as 'en' | 'ml' | 'hi'] ?? LIVE_COPY.en;
        if (intent === 'LIGHTS_STATUS') {
          const lamps = villageStatus.actuators?.streetlights;
          reply = lamps?.commanded ? copy.lightsOn : copy.lightsOff;
        } else if (intent === 'PUMP_STATUS') {
          const irrigation = villageStatus.irrigation;
          const running = irrigation?.state === 'pumping' || irrigation?.state === 'soaking';
          reply = running ? copy.pumpOn : copy.pumpOff;
        } else if (intent === 'VILLAGE_STATUS') {
          const live = describeVillage(
            { status: villageStatus, connected, stale, ageMs, demo: villageDemo },
            language as 'en' | 'ml' | 'hi',
          )
            .map((item) => item.text)
            .join(' ');
          if (live) reply = live;
        }
      }
      setState(kind === 'status' || kind === 'statement' || kind === 'hypothetical' ? 'success' : 'rejected');
      setMessage(reply);
      void speak(reply, intent);
      return;
    }

    const command = response.command ?? null;
    if (!command || !ALLOWED_COMMANDS.has(command)) {
      setState('rejected');
      const reply = response.message ?? 'That command is not supported here. Nothing was sent.';
      setMessage(reply);
      void speak(reply, intent);
      return;
    }

    // "Already off" may only come from a fresh, connected frame.  A cached or
    // stale reading must never make Sara skip an action the user asked for.
    const frameFresh = connected && !stale && (ageMs == null || ageMs < 5000);
    const already = response.already_text
      || (command === 'LIGHTS_OFF' ? 'The lights are already off.'
        : command === 'LIGHTS_ON' ? 'The lights are already on.'
        : '');
    if (frameFresh && alreadyInState(command, villageStatus) && already) {
      setState('success');
      setMessage(already);
      void speak(already, intent);
      return;
    }

    if (!connected) {
      const reply =
        intents.data?.messages?.disconnected?.[language]
        ?? "I can't reach the village controller. Please check its connection.";
      setState('disconnected');
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
    try {
      const commandOutcome = await send(command, {}, 'voice', requestId);
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
          intents.data?.messages?.unconfirmed?.[language]
            ?? commandOutcome.reason
            ?? 'The controller did not confirm the action. Do not assume anything happened.',
        );
      } else if (commandOutcome.status === 'duplicate') {
        setMessage(
          commandOutcome.reason ?? 'This command was already processed. The original decision stands.',
        );
      } else if (commandOutcome.status === 'confirmed') {
        // The pending sentence is true only while it is being sent; once the
        // controller acknowledges, the panel must state the new state, not the
        // intention.
        setMessage(
          response.done_text ||
            response.response_text ||
            'The controller confirmed the command.',
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
          ? (intents.data?.messages?.disconnected?.[language]
             ?? "I can't reach the village controller. Please check its connection.")
          : errorMessage(cause),
      );
    }
  }

  async function finish() {
    clearTimer();
    if (finishingRef.current) return;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;
    finishingRef.current = true;
    setState('processing');
    let blob: Blob;
    try {
      blob = await recorder.stop();
    } catch (cause) {
      setState('idle');
      setMicError(errorMessage(cause));
      finishingRef.current = false;
      return;
    }
    if (!blob || blob.size === 0) {
      setState('rejected');
      setMessage('No speech was detected. Press Start Speaking again and speak clearly.');
      finishingRef.current = false;
      return;
    }

    try {
      const response = await api.voiceTranscribe(blob, language);
      const text = response.text ?? response.transcript ?? '';
      await applyUtterance(response, text, utteranceId(text, startedRef.current));
    } catch (cause) {
      const apiError = cause instanceof ApiError ? cause : null;
      const unreachable = apiError ? apiError.status === 0 || apiError.status === 503 : true;
      setState(unreachable ? 'disconnected' : 'rejected');
      setMessage(
        unreachable
          ? 'The village service did not answer. No command was sent. Is the laptop backend running?'
          : errorMessage(cause),
      );
    } finally {
      finishingRef.current = false;
    }
  }

  async function submitTyped(event?: FormEvent) {
    event?.preventDefault();
    const text = typed.trim();
    if (!text || typedBusyRef.current) return;
    typedBusyRef.current = true;
    setMicError('');
    setTtsNote('');
    setState('processing');
    if (typedGestureRef.current?.text !== text) {
      typedGestureRef.current = { text, id: utteranceId(text, Date.now()) };
    }
    const requestId = typedGestureRef.current.id;
    try {
      // Same parser as the microphone: Whisper only changes how the words
      // arrive, never what they mean.
      const response = await api.voiceInterpret(text, language);
      setTyped('');
      typedGestureRef.current = null;
      await applyUtterance(response, response.transcript ?? text, requestId);
    } catch (cause) {
      const apiError = cause instanceof ApiError ? cause : null;
      const unreachable = apiError ? apiError.status === 0 || apiError.status === 503 : true;
      setState(unreachable ? 'disconnected' : 'rejected');
      setMessage(
        unreachable
          ? 'The village service did not answer. No command was sent. Is the laptop backend running?'
          : errorMessage(cause),
      );
    } finally {
      typedBusyRef.current = false;
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
    : speechState === 'off'
      ? `The speech service is not available on this laptop: ${readiness.data?.whisper?.message ?? 'the local model is missing.'}`
      : speechState === 'unknown'
        ? 'The speech service could not be checked, so recording is paused. The cards still work.'
        : '';

  // A board that is not answering is not a reason to refuse to listen: the
  // sentence and the answer are still the useful part, and the panel already
  // refuses to act on a command it cannot deliver ("I can't reach the village
  // controller").  A dead button that says nothing looked like a broken
  // microphone (reported 2026-11-17, with the board powered off).
  const offlineNote =
    !demo && !connected
      ? 'The board is not answering. You can still speak and see what the village understood, but nothing will move until it reconnects.'
      : '';

  const supported = micSupported && speechState !== 'off' && speechState !== 'unknown';
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
  // Exactly what the panel will send: the typed box while it has something in
  // it (it clears once the answer arrives), else the sentence Whisper heard.
  const typedNow = typed.trim();
  const staged = typedNow || transcript;
  // Whisper can answer in another script even when told which language it is:
  // Malayalam audio came back in Tamil script here (2026-11-17).  Saying that
  // is more useful than a generic "not understood", and the sentence stays on
  // screen so the reader can see what was actually heard.
  // Only worth saying when the village did not understand it: the parser
  // reads a sister script by sound now, so a Tamil spelling of a Malayalam
  // command is acted on, and an apology over a command that worked would be
  // its own confusion.
  const unclear =
    !result || result.status === 'unknown' || result.status === 'unsupported';
  const wrongScript =
    !typedNow &&
    Boolean(transcript) &&
    language !== 'en' &&
    !inScript(transcript, language) &&
    unclear;

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
              Say one short command in {languageLabel}, or type it below. Speech is recognised on
              this laptop.
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
        {!blocker && offlineNote && (
          <p className="voice-blocker voice-blocker--warn" data-testid="voice-offline-note">
            {offlineNote}
          </p>
        )}
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
          title={disabled && blocker ? blocker : undefined}
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
                : blocker
                  ? // Named here, at the control that is off, not only in the
                    // status chip above it.
                    'The microphone is off — see the reason above.'
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

      {/*
        Asked for 2026-11-17: the panel must say, in words, what it is about to
        send.  It used to show the sentence only after the round trip and below
        the type box, which read as a leftover rather than as the payload.
      */}
      <div className="voice-staged" data-testid="voice-staged">
        <p className="eyebrow">What will be sent</p>
        {state === 'listening' ? (
          <p className="voice-heard" data-testid="voice-staged-text">
            Listening — the sentence appears here the moment you stop.
          </p>
        ) : staged ? (
          <>
            <p className="voice-heard" data-testid="voice-staged-text">
              “{staged}”
            </p>
            <p className="hint">
              {typedNow
                ? 'This is exactly what Send gives the village.'
                : 'This is the sentence the village was given — Whisper only changes how the words arrive.'}
            </p>
            {wrongScript && (
              <p className="voice-blocker" data-testid="voice-script-note">
                The speech model did not hear {VOICE_LANGUAGE_NAMES[language] ?? language} clearly —
                that is not {VOICE_LANGUAGE_NAMES[language] ?? language} script. Say it again a
                little slower, or type it below.
              </p>
            )}
          </>
        ) : (
          <p className="voice-heard" data-testid="voice-staged-text">
            Nothing yet — speak, or type below, and the sentence appears here.
          </p>
        )}
      </div>

      <form className="voice-type" onSubmit={(event) => void submitTyped(event)}>
        <label className="eyebrow" htmlFor="voice-text">
          Or type it
        </label>
        <div className="voice-type-row">
          <input
            id="voice-text"
            className="input"
            data-testid="voice-text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="e.g. please switch the lights off"
            disabled={state === 'processing' || speaking}
            autoComplete="off"
            enterKeyHint="send"
          />
          <button
            className="btn btn--primary"
            type="submit"
            data-testid="voice-send"
            disabled={!typed.trim() || state === 'processing' || speaking}
          >
            Send
          </button>
        </div>
        <p className="hint">
          Typed words use the same rules as speech. A question, a refusal or an unclear
          request never sends anything.
        </p>
      </form>

      {result && (
        <div className="voice-result">
          <div className="voice-result-row">
            <span className="eyebrow">Intent</span>
            <span className="chip chip--neutral">
              {result.intent ?? 'not matched'}
              {result.kind ? ` · ${result.kind}` : ''}
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

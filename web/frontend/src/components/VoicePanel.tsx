import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CommandOutcome } from '../lib/commands';
import { useCommands } from '../lib/commands';
import { useDemo } from '../lib/demo';
import { ApiError, api, errorMessage } from '../lib/api';
import { VoiceRecorder, recordingSupported } from '../lib/audio';
import { useApi } from '../lib/useApi';
import { speakReply, speechSupported, stopSpeaking, voiceAvailable } from '../lib/speech';
import { useVillage } from '../lib/village';
import { useT } from '../lib/i18n';
import { LIVE_COPY, VOICE_GREETING, describeVillage, inScript } from '../lib/lia';
import { VOICE_LANGUAGES, useVoiceUi, type VoiceLanguage } from '../lib/voiceUi';
import { cx } from '../lib/format';
import type { DeviceStatus, VoiceIntent, VoiceIntentsResponse, VoiceTranscribeResponse } from '../types';
import { IconClose, IconMic, IconPlug, IconSpeaker } from './Icons';
import { LanguagePicker } from './LanguagePicker';
import { VOICE_EXAMPLES, VOICE_LANGUAGE_NAMES } from '../lib/voiceExamples';
import { VOICE_COPY, actionWords } from '../lib/voiceCopy';

const ALLOWED_COMMANDS = new Set([
  'LIGHTS_ON',
  'LIGHTS_OFF',
  'LIGHTS_AUTO',
  'IRRIGATION_REQUEST',
  'IRRIGATION_STOP',
  // The pump's Auto mode (2026-11-18) — the same switch the Watering card has.
  // Without this the panel refused a sentence the parser understood.
  'PUMP_AUTO',
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

type VoiceState = 'idle' | 'listening' | 'processing' | 'sending' | 'success' | 'rejected' | 'disconnected';

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
  const t = useT();
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
  // The language this recording was *started* in.  A request already on its way
  // finishes in the language it began in — never re-read through a selector the
  // visitor changed while waiting.
  const startedLanguageRef = useRef<VoiceLanguage>(language);
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

  const speak = async (text: string, intent: string | null, spokenLanguage = language) => {
    if (!text || speakingRef.current) return;
    if (settings.data && settings.data.tts_enabled === false) return;
    speakingRef.current = true;
    setSpeaking(true);
    setTtsNote('');
    try {
      const how = await speakReply(text, spokenLanguage, intent);
      if (how === 'none') {
        const ttsReady = Boolean(readiness.data?.tts?.ready);
        setTtsNote(
          !ttsReady && speechSupported() && !voiceAvailable(spokenLanguage)
            ? t('panel.noVoiceForLanguage', {
                language: VOICE_LANGUAGE_NAMES[spokenLanguage] ?? spokenLanguage,
              })
            : t('panel.replyNotRead'),
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
    setTtsNote('');
    // Clear the *request*, keep the *reply*.
    //
    // The request card is about to hold the sentence being spoken now, and
    // leaving the previous one under "Your request" while the visitor talks
    // reads as "it already heard me" (asked 2026-11-18).  The reply is a
    // different thing: it answers the previous question, and blanking it would
    // take away what the visitor was reading.
    setTranscript('');
    try {
      const recorder = new VoiceRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      startedLanguageRef.current = language;
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
          ? `${t('panel.micFailed')} (${cause.message})`
          : t('panel.micFailed'),
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
    lang: VoiceLanguage,
  ) {
    const kind = kindOf(response);
    const intent = response.intent ?? null;
    setResult(response);
    setTranscript(transcript);

    if (kind === 'no_speech') {
      setState('rejected');
      const reply = response.message ?? t('panel.noSpeech');
      setMessage(reply);
      void speak(reply, intent, lang);
      return;
    }

    if (kind !== 'command') {
      let reply =
        response.message ??
        response.response_text ??
        t('panel.onlyAnswers');
      // A status question is answered from the frame on screen, in the selected
      // lang, rather than from a canned sentence.
      if (kind === 'status' && villageStatus) {
        const copy = LIVE_COPY[lang as 'en' | 'ml' | 'hi'] ?? LIVE_COPY.en;
        if (intent === 'LIGHTS_STATUS') {
          const lamps = villageStatus.actuators?.streetlights;
          reply = lamps?.commanded ? copy.lightsOn : copy.lightsOff;
        } else if (intent === 'PUMP_STATUS') {
          const irrigation = villageStatus.irrigation;
          const running = irrigation?.state === 'pumping' || irrigation?.state === 'soaking';
          reply = running ? copy.pumpOn : copy.pumpOff;
        } else if (intent === 'WATER_STATUS') {
          // The catalogue's answer is generic ("the dashboard shows which"),
          // which is no use to somebody standing in front of the panel.  The
          // frame is right here, so answer from it.
          const tank = villageStatus.sensors?.reservoir;
          reply =
            tank?.state === 'available'
              ? copy.tankAvailable
              : tank?.state === 'low'
                ? copy.tankLow
                : tank?.state === 'uncalibrated'
                  ? copy.tankUncalibrated
                  : copy.tankUnavailable;
        } else if (intent === 'SOIL_STATUS') {
          const soil = villageStatus.sensors?.soil;
          // The sentence already ends with "%", so this is the number only.
          const pct =
            soil?.calibrated && soil.percent != null ? `${Math.round(soil.percent)}` : '';
          reply =
            soil?.state === 'dry'
              ? copy.soilDry(pct)
              : soil?.state === 'adequate'
                ? copy.soilAdequate(pct)
                : soil?.state === 'wet'
                  ? copy.soilWet(pct)
                  : soil?.state === 'uncalibrated'
                    ? copy.soilUncalibrated
                    : copy.soilUnavailable;
        } else if (intent === 'VILLAGE_STATUS') {
          const live = describeVillage(
            { status: villageStatus, connected, stale, ageMs, demo: villageDemo },
            lang as 'en' | 'ml' | 'hi',
          )
            .map((item) => item.text)
            .join(' ');
          if (live) reply = live;
        }
      }
      setState(kind === 'status' || kind === 'statement' || kind === 'hypothetical' ? 'success' : 'rejected');
      setMessage(reply);
      void speak(reply, intent, lang);
      return;
    }

    const command = response.command ?? null;
    if (!command || !ALLOWED_COMMANDS.has(command)) {
      setState('rejected');
      const reply = response.message ?? t('panel.notSupported');
      setMessage(reply);
      void speak(reply, intent, lang);
      return;
    }

    // "Already off" may only come from a fresh, connected frame.  A cached or
    // stale reading must never make Sara skip an action the user asked for.
    const frameFresh = connected && !stale && (ageMs == null || ageMs < 5000);
    const already = response.already_text
      || (command === 'LIGHTS_OFF' ? t('panel.alreadyOff')
        : command === 'LIGHTS_ON' ? t('panel.alreadyOn')
        : '');
    if (frameFresh && alreadyInState(command, villageStatus) && already) {
      setState('success');
      setMessage(already);
      void speak(already, intent, lang);
      return;
    }

    if (!connected) {
      const reply =
        intents.data?.messages?.disconnected?.[lang]
        ?? t('panel.cannotReach');
      setState('disconnected');
      setMessage(reply);
      void speak(reply, intent, lang);
      return;
    }

    setState('sending');
    setMessage(
      response.pending_text ??
        response.message ??
        t('panel.sending'),
    );
    try {
      const commandOutcome = await send(command, {}, 'voice', requestId);
      setOutcome(commandOutcome);
      if (commandOutcome.status === 'rejected') {
        setState('rejected');
        setMessage(
          commandOutcome.reason ??
            t('panel.refused'),
        );
      } else if (commandOutcome.status === 'unconfirmed') {
        setState('disconnected');
        setMessage(
          intents.data?.messages?.unconfirmed?.[lang]
            ?? commandOutcome.reason
            ?? t('panel.unconfirmed'),
        );
      } else if (commandOutcome.status === 'duplicate') {
        // A repeated id is a real answer: the first decision stands.
        setState('success');
        setMessage(
          commandOutcome.reason ?? t('panel.duplicate'),
        );
      } else if (commandOutcome.status === 'confirmed') {
        // The pending sentence is true only while it is being sent; once the
        // controller acknowledges, the panel must state the new state, not the
        // intention.
        setState('success');
        setMessage(
          response.done_text ||
            response.response_text ||
            t('panel.confirmed'),
        );
      }
      // Speak in the visitor's lang, always.  The controller's reason is
      // written in English by the firmware; handing that to the Malayalam voice
      // produced a sentence of Malayalam sounds around English words, which is
      // what a visitor reported as "she answered in something weird"
      // (2026-11-17).  The reason is still shown on screen when it is the
      // answer — a refusal — and a refusal has its own sentence to say.
      const spoken =
        commandOutcome.status === 'confirmed'
          ? response.done_text || response.response_text || ''
          : commandOutcome.status === 'duplicate'
            ? response.already_text || response.done_text || ''
            : commandOutcome.status === 'rejected'
              ? (intents.data?.messages?.refused?.[lang] ?? '')
              : (intents.data?.messages?.unconfirmed?.[lang] ?? '');
      if (spoken) void speak(spoken, intent, lang);
    } catch (cause) {
      const apiError = cause instanceof ApiError ? cause : null;
      const unreachable = apiError ? apiError.status === 0 || apiError.status === 503 : true;
      setState(unreachable ? 'disconnected' : 'rejected');
      setMessage(
        unreachable
          ? (intents.data?.messages?.disconnected?.[lang]
             ?? t('panel.cannotReach'))
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
      setMessage(t('panel.noSpeech'));
      finishingRef.current = false;
      return;
    }

    try {
      // The recording's own language, captured when Start was pressed.
      const spokenIn = startedLanguageRef.current;
      const response = await api.voiceTranscribe(blob, spokenIn);
      const text = response.text ?? response.transcript ?? '';
      await applyUtterance(response, text, utteranceId(text, startedRef.current), spokenIn);
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
      const typedIn = language;
      const response = await api.voiceInterpret(text, typedIn);
      setTyped('');
      typedGestureRef.current = null;
      await applyUtterance(response, response.transcript ?? text, requestId, typedIn);
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

  const copy = VOICE_COPY[language] ?? VOICE_COPY.en;
  const examples = VOICE_EXAMPLES[language] ?? VOICE_EXAMPLES.en;

  const blocker = !micSupported
    ? t('panel.noRecording')
    : speechState === 'off'
      ? // The service's own reason is English; it is useful to the presenter, so
        // English keeps it and the other two languages say the same thing.
        `${t('panel.speechUnavailable')}${
          language === 'en' && readiness.data?.whisper?.message
            ? ` (${readiness.data.whisper.message})`
            : ''
        }`
      : speechState === 'unknown'
        ? t('panel.speechUnknown')
        : '';

  // A board that is not answering is not a reason to refuse to listen: the
  // sentence and the answer are still the useful part, and the panel already
  // refuses to act on a command it cannot deliver ("I can't reach the village
  // controller").  A dead button that says nothing looked like a broken
  // microphone (reported 2026-11-17, with the board powered off).
  const offlineNote =
    !demo && !connected
      ? t('panel.offlineNote')
      : '';

  const supported = micSupported && speechState !== 'off' && speechState !== 'unknown';
  const busy = state === 'processing' || state === 'sending';
  const disabled = speaking || busy || !supported;
  const unavailable = new Set(readiness.data?.unavailable_languages ?? []);

  // The three examples a visitor is shown are the headline ones; "More
  // examples" is the parser's own catalogue, minus anything already above it.
  const headlineIntents = new Set(examples.map((example) => example.intent));
  const moreIntents = orderedIntents(intents.data).filter(
    (intent) => !headlineIntents.has(intent.id),
  );

  // Whichever sentence is in front of the visitor right now.
  const typedNow = typed.trim();
  const staged = typedNow || transcript;

  // Whisper can answer in another script even when told which language it is:
  // Malayalam audio came back in Tamil script here (2026-11-17).  Saying that
  // is more useful than a generic "not understood", and the sentence stays on
  // screen so the reader can see what was actually heard.  The parser reads a
  // sister script by sound now, so the note waits until the village really did
  // not understand it.
  const unclear = !result || result.status === 'unknown' || result.status === 'unsupported';
  const wrongScript =
    !typedNow &&
    Boolean(transcript) &&
    language !== 'en' &&
    !inScript(transcript, language) &&
    unclear;

  // One short word for "what is happening", so the six states are told apart
  // by text and not only by colour.
  const stateWord =
    state === 'listening'
      ? copy.states.listening
      : state === 'processing'
        ? copy.states.understanding
        : state === 'sending'
          ? copy.states.sending
          : state === 'disconnected'
            ? copy.states.notConnected
            : state === 'rejected'
              ? copy.states.blocked
              : state === 'success'
                ? outcome?.status === 'confirmed'
                  ? copy.states.confirmed
                  : copy.states.answer
                : '';
  const stateTone =
    state === 'rejected'
      ? 'is-blocked'
      : state === 'disconnected'
        ? 'is-offline'
        : state === 'success' && outcome?.status === 'confirmed'
          ? 'is-ok'
          : state === 'listening'
            ? 'is-live'
            : '';

  const readinessWord = demo
    ? copy.states.simulation
    : !micSupported
      ? copy.states.noMic
      : !connected
        ? copy.states.offline
        : speechState === 'off'
          ? copy.states.serviceOff
          : speechState === 'unknown'
            ? copy.states.unchecked
            : speechState === 'checking'
              ? copy.states.checking
              : copy.states.ready;

  if (!open) return null;

  return (
    <section
      className="voice-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-panel-title"
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
            <h2 className="voice-title" id="voice-panel-title">
              {copy.title}
            </h2>
            <p className="voice-subtitle">{copy.intro}</p>
          </div>
        </div>
        <button
          className="icon-btn voice-close"
          type="button"
          onClick={closePanel}
          aria-label={t('panel.close')}
        >
          <IconClose size={18} />
        </button>
      </header>

      {/* 1. The language and the state it will be spoken in, on one line. */}
      <div className="voice-topline">
        <LanguagePicker
          options={VOICE_LANGUAGES.map((entry) => ({
            code: entry.code,
            label: entry.label,
            note: unavailable.has(entry.code) ? 'understood, not spoken' : undefined,
          }))}
          value={language}
          onChange={(code) => setLanguage(code as VoiceLanguage)}
          label="Spoken language"
          disabled={state === 'listening' || busy}
          testId="voice-lang"
        />
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
            {readinessWord}
          </span>
          {demo && (
            <p className="voice-sim" data-testid="voice-simulation">
              {copy.simulation}
            </p>
          )}
          {blocker && <p className="voice-blocker">{blocker}</p>}
          {!blocker && offlineNote && (
            <p className="voice-blocker voice-blocker--warn" data-testid="voice-offline-note">
              {offlineNote}
            </p>
          )}
          {!blocker && villageLoading && (
            <p className="voice-blocker">{t('panel.waitingBoard')}</p>
          )}
        </div>
      </div>

      {/* 2. Start or stop speaking. */}
      <div className={cx('voice-stage', state === 'listening' && 'is-listening')}>
        <button
          type="button"
          className={cx('ptt', state === 'listening' && 'is-live')}
          onClick={() => {
            if (state === 'listening') void finish();
            else void start();
          }}
          disabled={disabled && state !== 'listening'}
          aria-label={state === 'listening' ? copy.stop : copy.start}
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
              {state === 'listening' ? copy.stop : speaking ? copy.states.listening : copy.start}
            </span>
            <span className="ptt-hint">
              {state === 'listening'
                ? `${elapsed.toFixed(1)}s / ${MAX_SECONDS}s · ${copy.stop}`
                : blocker
                  ? // Named here, at the control that is off, not only in the
                    // status chip above it.
                    'The microphone is off — see the reason above.'
                  : copy.pttHint}
            </span>
          </span>
        </button>

        <div className="voice-state" aria-live="polite">
          {state === 'listening' && (
            <p className="voice-listening">
              <span className="wave" aria-hidden="true">
                <i /> <i /> <i /> <i />
              </span>
              {copy.listening}
            </p>
          )}
          {micError && <p className="error-text">{micError}</p>}
          {ttsNote && <p className="hint">{ttsNote}</p>}
        </div>
      </div>

      {/* 3 and 4. What was said, and what Sara answered.  Both stay on screen
          until a newer request replaces them. */}
      <div className="voice-said">
        <section className="voice-block" data-testid="voice-staged">
          <p className="eyebrow">{copy.request}</p>
          <p className={cx('voice-heard', !staged && 'is-empty')} data-testid="voice-staged-text">
            {staged ? `“${staged}”` : state === 'listening' ? copy.listening : copy.requestEmpty}
          </p>
          {wrongScript && (
            <p className="voice-blocker" data-testid="voice-script-note">
              {t('panel.notLanguageScript', {
                language: VOICE_LANGUAGE_NAMES[language] ?? language,
              })}
            </p>
          )}
        </section>

        <section className="voice-block voice-block--reply" data-testid="voice-reply">
          <div className="voice-block-head">
            <p className="eyebrow">{copy.reply}</p>
            {stateWord && (
              <span className={cx('voice-state-word', stateTone)} data-testid="voice-state-word">
                {stateWord}
              </span>
            )}
          </div>
          <p
            className={cx(
              'voice-message',
              !message && 'is-empty',
              state === 'rejected' && 'is-rejected',
            )}
            data-testid="voice-reply-text"
          >
            {message || copy.replyEmpty}
          </p>
          {outcome && outcome.status !== 'confirmed' && (
            <p
              className={cx(
                'voice-outcome',
                outcome.status === 'rejected' && 'is-rejected',
                outcome.status === 'unconfirmed' && 'is-warn',
              )}
              data-testid="voice-command-outcome"
            >
              {/* The state word is already on the row above; this line is the
                  controller's own reason, in words — never a reason code. */}
              {outcome.reason || stateWord}
            </p>
          )}
        </section>
      </div>

      {/* 5. The keyboard route to the same parser. */}
      <form className="voice-type" onSubmit={(event) => void submitTyped(event)}>
        <label className="eyebrow" htmlFor="voice-text">
          {copy.typed}
        </label>
        <div className="voice-type-row">
          <input
            id="voice-text"
            className="input"
            data-testid="voice-text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={examples[0]?.phrase ?? ''}
            disabled={busy || speaking}
            autoComplete="off"
            enterKeyHint="send"
          />
          <button
            className="btn btn--primary"
            type="submit"
            data-testid="voice-send"
            disabled={!typed.trim() || busy || speaking}
          >
            {copy.send}
          </button>
        </div>
        <p className="hint">{copy.typedHelper}</p>
      </form>

      {/* 6. Three useful sentences, then the rest on request. */}
      <div className="voice-help">
        <p className="eyebrow">{copy.examples}</p>
        <ul className="voice-examples">
          {examples.map((example) => (
            <li key={example.intent}>
              <span className="help-phrase">“{example.phrase}”</span>
              <span className="help-note">{example.explanation}</span>
            </li>
          ))}
        </ul>
        {moreIntents.length > 0 && (
          <details className="voice-more">
            <summary>{copy.moreExamples}</summary>
            <ul className="voice-more-list">
              {moreIntents.map((intent) => (
                <li key={intent.id}>
                  <span className="help-label">{intentLabel(intent, language)}</span>
                  <span className="help-phrase">
                    “{intentPhrases(intent, language)[0] ?? intentLabel(intent, language)}”
                  </span>
                  <span className="help-note">{actionWords(copy, intent.command)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <p className="voice-privacy">{copy.privacy}</p>
    </section>
  );
}

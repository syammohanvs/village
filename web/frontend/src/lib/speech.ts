import { api } from './api';

const SPEECH_LANG: Record<string, string> = {
  en: 'en-IN',
  ml: 'ml-IN',
  hi: 'hi-IN',
};

/**
 * Voices that are known to be female.  A bare `lang` is not enough: browsers
 * pick the system default voice for a language, which is often a male one
 * (Microsoft David on Windows), and Lia is a girl.
 */
const FEMALE_NAMES = [
  'female',
  'zira',
  'hazel',
  'susan',
  'samantha',
  'victoria',
  'karen',
  'moira',
  'tessa',
  'fiona',
  'aria',
  'jenny',
  'michelle',
  'sonia',
  'libby',
  'natasha',
  'swara',
  'kalpana',
  'heera',
  'veena',
  'lekha',
  'priya',
  'google uk english female',
  'google us english',
  'google हिन्दी',
  'google മലയാളം',
];

/** Male voices, used only to break a tie when no female voice exists. */
const MALE_NAMES = ['male', 'david', 'mark', 'daniel', 'alex', 'fred', 'rishi', 'hemant', 'ravi', 'george'];

let cachedVoices: SpeechSynthesisVoice[] = [];
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
// Every speak call takes a ticket.  A slow synthesis for a language the reader
// has already left must not start playing over the one they are on.
let speakSeq = 0;

/**
 * Whether the page has had a user gesture.
 *
 * Browsers refuse to start an audio element before one, which is why a greeting
 * that plays on load only ever came out after the visitor pressed something --
 * usually Start Camera, which read as "Sara only speaks when I press that".
 */
function hasUserActivation(): boolean {
  const activation = (
    navigator as unknown as { userActivation?: { hasBeenActive?: boolean } }
  ).userActivation;
  if (!activation || typeof activation.hasBeenActive !== 'boolean') return true;
  return activation.hasBeenActive;
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * How a word is *said*, as opposed to how it is written.
 *
 * 1. The English phonemiser reads `Sara` as /s ˈ ɛ ɹ ə/ — "SEH-ra", the
 *    American name — while our Sara is സാറ / सारा, /ˈsɑːrə/, "SAA-ra".  Writing
 *    it `Sahra` for the engine only gives exactly that (verified with
 *    `piper_phonemize`: `s ˈ ɑː ɹ ə`, one r — `Saara` doubles the r), and the
 *    page keeps showing "Sara" (asked 2026-11-17).
 *
 * 2. A sentence-final `you` is an unstressed pronoun, so the voice reduces it:
 *    `j u ː`, a short vowel squeezed into the gap before the question mark.
 *    Measured on the greeting, the closing word was 140 ms at 13.3 % of the
 *    sentence's peak — audible on a phone, easy to lose across a room.  The
 *    stressed spelling `yoo` is the *same* sound (`j ˈ u ː`, still one long
 *    vowel, unlike `yuu` which doubles it) and measured 200 ms at 15.9 %,
 *    which is a fully spoken word.  Only a sentence-final `you` is respelled:
 *    mid-sentence it is a normal unstressed pronoun and nothing is wrong with
 *    it, so "Can you turn off the lights?" is passed through untouched.
 */
const ENGLISH_SAY: [RegExp, string][] = [
  [/\bSara\b/gi, 'Sahra'],
  [/\byou\b(?=\s*(?:[.?!…]|$))/gi, 'yoo'],
];

/** The text to hand the voice, which is not always the text on screen. */
export function spokenText(text: string, language: string): string {
  if (language !== 'en') return text;
  return ENGLISH_SAY.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

export function speechLanguage(language: string): string {
  return SPEECH_LANG[language] ?? language;
}

/**
 * Chrome fills the voice list asynchronously: the first getVoices() call is
 * often empty, which previously made every language look "available" and then
 * produced silence.  Wait for `voiceschanged`, with a timeout for browsers
 * that never fire it.
 */
export function primeVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const immediate = synth.getVoices();
  if (immediate.length > 0) {
    cachedVoices = immediate;
    return Promise.resolve(immediate);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.('voiceschanged', finish);
      cachedVoices = synth.getVoices();
      resolve(cachedVoices);
    };
    synth.addEventListener?.('voiceschanged', finish);
    window.setTimeout(finish, timeoutMs);
  });
}

function voiceList(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  if (cachedVoices.length === 0) {
    try {
      cachedVoices = window.speechSynthesis.getVoices();
    } catch {
      cachedVoices = [];
    }
  }
  return cachedVoices;
}

function nameScore(voice: SpeechSynthesisVoice): number {
  const name = (voice.name || '').toLowerCase();
  if (FEMALE_NAMES.some((entry) => name.includes(entry))) return 2;
  if (MALE_NAMES.some((entry) => name.includes(entry))) return 0;
  return 1;
}

/**
 * Voices known to be Indian English.  Several engines ship an Indian voice
 * under a wider tag (`en-GB` on some Android builds, `en` on others), so the
 * name is checked as well as the language: a voice called Neerja or Heera is
 * Indian whatever it is tagged.
 */
const INDIAN_VOICE_NAMES = ['neerja', 'heera', 'kalpana', 'swara', 'veena', 'lekha', 'priya', 'prabhat', 'rishi'];

/**
 * An Indian-English voice installed on this device, female first.
 *
 * Piper has no en_IN voice — its English model is American — so for English we
 * prefer the device's own Indian voice when it has one.  Hindi and Malayalam
 * stay on Piper, whose voices for those languages are Indian.
 */
export function pickIndianEnglishVoice(): SpeechSynthesisVoice | null {
  const voices = voiceList();
  if (voices.length === 0) return null;
  const tag = (voice: SpeechSynthesisVoice) => (voice.lang || '').toLowerCase().replace('_', '-');
  const named = (voice: SpeechSynthesisVoice) =>
    INDIAN_VOICE_NAMES.some((entry) => (voice.name || '').toLowerCase().includes(entry));
  // An `en-IN` tag is the strongest signal; a known Indian name is the
  // fallback for engines that tag their Indian voice differently.
  const indian = voices.filter(
    (voice) => tag(voice).startsWith('en') && (tag(voice) === 'en-in' || named(voice)),
  );
  if (indian.length === 0) return null;
  const female = indian.filter((voice) => nameScore(voice) === 2);
  return (female[0] ?? indian[0]) as SpeechSynthesisVoice;
}

/**
 * Which English voice Sara uses.
 *
 * `sara` is the local neural voice — one speaker across all three languages —
 * but its English model is American.  `device-india` uses this computer's
 * Indian-English voice instead (Windows ships "Heera" and "Ravi"; Android and
 * some Linux setups have an en-IN one too), which has the accent the exhibit
 * wants at the cost of a different speaker for English only.
 *
 * It is a per-device choice, like the camera and the volume: a voice is
 * installed on a machine, not on an account.
 */
export type EnglishVoiceChoice = 'sara' | 'device-india';

export const ENGLISH_VOICE_KEY = 'village.englishVoice';

export function loadEnglishVoiceChoice(): EnglishVoiceChoice {
  try {
    // Default is the Indian accent, which is what the exhibit asked for
    // (2026-11-17).  It is safe as a default: when the machine has neither the
    // Indian model nor an en-IN device voice, Sara's own voice is used anyway.
    return window.localStorage.getItem(ENGLISH_VOICE_KEY) === 'sara' ? 'sara' : 'device-india';
  } catch {
    return 'device-india';
  }
}

export function saveEnglishVoiceChoice(choice: EnglishVoiceChoice): void {
  try {
    window.localStorage.setItem(ENGLISH_VOICE_KEY, choice);
  } catch {
    /* private modes can refuse storage; the choice still holds this visit */
  }
}

/** The name of this device's Indian-English voice, or null when it has none. */
export function indianEnglishVoiceName(): string | null {
  return pickIndianEnglishVoice()?.name ?? null;
}

/** The best voice for a language: same language, female first. */
export function pickVoice(language: string): SpeechSynthesisVoice | null {
  const voices = voiceList();
  if (voices.length === 0) return null;
  const wanted = speechLanguage(language).toLowerCase();
  const prefix = wanted.split('-')[0];
  const sameLanguage = voices.filter((voice) => (voice.lang || '').toLowerCase().startsWith(prefix));
  if (sameLanguage.length === 0) return null;
  // Prefer a regional exact match, then a female name, then anything.
  const exact = sameLanguage.filter((voice) => (voice.lang || '').toLowerCase() === wanted);
  const pool = exact.length > 0 ? exact : sameLanguage;
  return [...pool].sort((a, b) => nameScore(b) - nameScore(a))[0] ?? null;
}

function playAudioFile(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const audio = new Audio(url);
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      const played = audio.play();
      // A resolved play() means the recording has started.  Waiting for
      // "ended" here (or timing it out) used to report failure while it was
      // still playing, and the caller then spoke the same words again.
      if (played && typeof played.then === 'function') {
        played.then(() => finish(true)).catch(() => finish(false));
      } else {
        finish(true);
      }
    } catch {
      finish(false);
    }
  });
}

function stopPlayback(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

function playBlob(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      stopPlayback();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      currentUrl = url;
      audio.onended = () => {
        finish(true);
        stopPlayback();
      };
      audio.onerror = () => {
        finish(false);
        stopPlayback();
      };
      const played = audio.play();
      // Success is "playback started", not "playback finished": a sentence is
      // seconds long, and treating a still-playing clip as a failure made the
      // caller speak the same text with the browser voice on top of it —
      // two women reading one sentence at once.
      if (played && typeof played.then === 'function') {
        played.then(() => finish(true)).catch(() => finish(false));
      } else {
        finish(true);
      }
    } catch {
      finish(false);
    }
  });
}

/**
 * Speak text.  The local Piper voice is used for every language so the three
 * sound like one speaker; the browser's own synthesis is only a fallback for
 * a machine without the Piper models.  Returns false when neither produced
 * sound, so a caller can say so instead of leaving a silent pause.
 */
export async function speakText(text: string, language: string, rate = 0.98): Promise<boolean> {
  if (!text) return false;
  const said = spokenText(text, language);
  const ticket = ++speakSeq;
  // Whatever is playing belongs to the previous reply; the ticket above makes
  // a late synthesis inert, and this stops audio that has already started.
  stopPlayback();

  // English: prefer Piper (the same clean local voice used for Malayalam and
  // Hindi).  The device's own Indian-English voice is only a fallback,
  // because some of those voices are noisy or robotic and the user reported
  // English sounding worse than the other two languages.
  // (Piper is attempted below for every language, so English now follows the
  // same path as Malayalam and Hindi.)

  // Before the first gesture the page cannot start an audio element at all, so
  // asking Piper first produced a refused play() and then a fallback -- which
  // is why the greeting only appeared after the visitor pressed something.  The
  // device voice is allowed without a gesture, so it is tried first in exactly
  // that case; Piper (the better voice) takes over once there has been a tap.
  if (!hasUserActivation()) {
    const spoken = await speakWithDevice(said, language, rate, ticket);
    if (spoken) return true;
    if (ticket !== speakSeq) return false;
  }

  // Piper's --length_scale is the inverse of a rate: >1 is slower.
  const lengthScale = Math.max(0.5, Math.min(2, 0.98 / (rate || 0.98)));
  // English carries its own voice choice: the neural Indian model when the
  // exhibit asked for that accent, Sara's American one otherwise.
  const variant =
    language === 'en' ? (loadEnglishVoiceChoice() === 'device-india' ? 'indian' : 'sara') : undefined;
  try {
    const spokenScale = Number(lengthScale.toFixed(3));
    // Only English carries a voice choice; the other two languages are one
    // voice each, and passing an extra argument would only make the call
    // harder to read in the log.
    const blob = variant
      ? await api.speak(said, language, spokenScale, variant)
      : await api.speak(said, language, spokenScale);
    // A newer call (another language, another view) owns the speakers now.
    if (ticket !== speakSeq) return false;
    if (await playBlob(blob)) return true;
    if (ticket !== speakSeq) return false;
    // One retry: a browser occasionally refuses the first play() after a tab
    // switch, and that is not a reason to change voice.
    if (await playBlob(blob)) return true;
    // Piper *has* the audio, so the only thing standing between the reader and
    // Sara's normal voice is playback.  Reading the same sentence in the
    // device's voice instead would change accent mid-session -- reported
    // exactly that way: "she speaks fine, then one line came out in a weird
    // accent".  Silence is the lesser fault.
    return false;
  } catch {
    /* Piper is unavailable for this utterance -- use the browser voice */
  }
  if (ticket !== speakSeq) return false;

  return speakWithDevice(said, language, rate, ticket);
}

/** The browser's own voices: an Indian-English one first, then the best match. */
async function speakWithDevice(
  text: string,
  language: string,
  rate: number,
  ticket: number,
): Promise<boolean> {
  if (!speechSupported()) return false;
  if (language === 'en') {
    await primeVoices(600);
    const indian = pickIndianEnglishVoice();
    if (indian) {
      const spoken = await speakWithVoice(text, indian, rate, ticket);
      if (spoken) return true;
      if (ticket !== speakSeq) return false;
    }
  }
  await primeVoices();
  const voice = pickVoice(language);
  if (!voice) return false;
  return speakWithVoice(text, voice, rate, ticket);
}

function speakWithVoice(
  text: string,
  voice: SpeechSynthesisVoice,
  rate: number,
  ticket: number,
): Promise<boolean> {
  if (ticket !== speakSeq) return Promise.resolve(false);
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    let settled = false;
    let started = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice.lang || speechLanguage('en');
    utterance.voice = voice;
    utterance.rate = rate;
    utterance.onstart = () => {
      started = true;
    };
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    // Some engines never report the end of a long utterance.  Timing out is
    // only a failure if the voice never began: once it has, reporting failure
    // would make the caller read the same sentence again with the other
    // engine, which is exactly two voices at once.
    window.setTimeout(() => finish(started), 5000 + Math.min(120000, text.length * 160));
    // A voice that never begins (an offline "natural" voice is the usual one)
    // would otherwise leave the reader with silence.  Cancel it and report
    // failure so the caller can use the local engine.
    window.setTimeout(() => {
      if (started || settled) return;
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      finish(false);
    }, 1400);
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  // Invalidate anything still being synthesised.
  speakSeq += 1;
  stopPlayback();
  if (speechSupported()) window.speechSynthesis.cancel();
}

/**
 * Speak a reply. Prefers a prepared local recording (`/audio/<lang>/<intent>.wav`)
 * and falls back to the browser's own speech synthesis.
 */
export async function speakReply(
  text: string,
  language: string,
  intent: string | null | undefined,
): Promise<'audio' | 'speech' | 'none'> {
  if (intent) {
    const url = `/audio/${encodeURIComponent(language)}/${encodeURIComponent(intent)}.wav`;
    if (await playAudioFile(url)) return 'audio';
  }
  if (await speakText(text, language)) return 'speech';
  return 'none';
}

/**
 * True when the browser reports at least one voice for the language.
 * After `primeVoices()` has run this is accurate; before that an empty list is
 * reported as available rather than warning about a problem that may not exist.
 */
export function voiceAvailable(language: string): boolean {
  if (!speechSupported()) return false;
  const voices = voiceList();
  if (voices.length === 0) return true;
  const prefix = speechLanguage(language).split('-')[0].toLowerCase();
  return voices.some((voice) => (voice.lang || '').toLowerCase().startsWith(prefix));
}

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

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
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
  const ticket = ++speakSeq;
  // Whatever is playing belongs to the previous reply; the ticket above makes
  // a late synthesis inert, and this stops audio that has already started.
  stopPlayback();

  // English first: use an Indian voice from this device if one is installed.
  // The wait is short on purpose — holding the first press for the voice list
  // is what made a press look like it did nothing.
  if (language === 'en' && speechSupported()) {
    await primeVoices(600);
    const indian = pickIndianEnglishVoice();
    if (indian) {
      const spoken = await speakWithVoice(text, indian, rate, ticket);
      if (spoken) return true;
      if (ticket !== speakSeq) return false;
    }
  }

  // Piper's --length_scale is the inverse of a rate: >1 is slower.
  const lengthScale = Math.max(0.5, Math.min(2, 0.98 / (rate || 0.98)));
  try {
    const blob = await api.speak(text, language, Number(lengthScale.toFixed(3)));
    // A newer call (another language, another view) owns the speakers now.
    if (ticket !== speakSeq) return false;
    if (await playBlob(blob)) return true;
  } catch {
    /* fall through to the browser voice */
  }
  if (ticket !== speakSeq) return false;

  if (!speechSupported()) return false;
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

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
export function primeVoices(): Promise<SpeechSynthesisVoice[]> {
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
    window.setTimeout(finish, 1500);
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
      if (played && typeof played.catch === 'function') {
        played.catch(() => finish(false));
      }
      window.setTimeout(() => {
        if (!settled) {
          try {
            audio.pause();
          } catch {
            /* ignore */
          }
          finish(false);
        }
      }, 1200);
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
      if (played && typeof played.catch === 'function') {
        played.catch(() => finish(false));
      }
      // A browser that never starts playback must not leave the button busy.
      window.setTimeout(() => finish(false), 1500);
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
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLanguage(language);
    utterance.voice = voice;
    utterance.rate = rate;
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    window.setTimeout(() => finish(false), 2500 + Math.min(60000, text.length * 90));
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

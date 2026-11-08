const SPEECH_LANG: Record<string, string> = {
  en: 'en-IN',
  ml: 'ml-IN',
  hi: 'hi-IN',
};

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function speechLanguage(language: string): string {
  return SPEECH_LANG[language] ?? language;
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

export function speakText(text: string, language: string, rate = 0.98): Promise<void> {
  if (!text || !speechSupported()) return Promise.resolve();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLanguage(language);
    utterance.rate = rate;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
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
  if (speechSupported()) {
    await speakText(text, language);
    return 'speech';
  }
  return 'none';
}

/**
 * True when the browser reports at least one voice for the language.
 * An empty voice list means "not known yet", so it is reported as available
 * rather than warning the reader about a problem that may not exist.
 */
export function voiceAvailable(language: string): boolean {
  if (!speechSupported()) return false;
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return true;
    const prefix = speechLanguage(language).split('-')[0].toLowerCase();
    return voices.some((voice) => (voice.lang || '').toLowerCase().startsWith(prefix));
  } catch {
    return true;
  }
}

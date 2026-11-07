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

export function speakText(text: string, language: string): Promise<void> {
  if (!text || !speechSupported()) return Promise.resolve();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLanguage(language);
    utterance.rate = 0.98;
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

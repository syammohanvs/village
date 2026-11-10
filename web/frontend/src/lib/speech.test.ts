import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeVoice = { name: string; lang: string; default: boolean; localService: boolean; voiceURI: string };

const VOICES: FakeVoice[] = [
  { name: 'Microsoft David - English (India)', lang: 'en-IN', default: true, localService: true, voiceURI: 'david' },
  { name: 'Microsoft Zira - English (India)', lang: 'en-IN', default: false, localService: true, voiceURI: 'zira' },
  { name: 'Google हिन्दी', lang: 'hi-IN', default: false, localService: false, voiceURI: 'hi' },
  { name: 'Microsoft Hemant - Hindi (India)', lang: 'hi-IN', default: true, localService: true, voiceURI: 'hemant' },
];

function installSpeech(voices: FakeVoice[]) {
  const spoken: { text: string; voice: string | undefined; lang: string }[] = [];
  class FakeUtterance {
    text: string;
    lang = '';
    rate = 1;
    voice: FakeVoice | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const synth = {
    getVoices: () => voices,
    speak: vi.fn((utterance: FakeUtterance) => {
      spoken.push({ text: utterance.text, voice: utterance.voice?.name, lang: utterance.lang });
      utterance.onend?.();
    }),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance });
  return { spoken, synth };
}

describe('speech voice choice', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('picks a female voice for English instead of the system default male one', async () => {
    const { spoken } = installSpeech(VOICES);
    const speech = await import('./speech');
    await speech.primeVoices();

    const ok = await speech.speakText('Hello', 'en');

    expect(ok).toBe(true);
    expect(spoken[0]?.voice).toMatch(/Zira/);
    expect(spoken[0]?.lang).toBe('en-IN');
  });

  it('does not speak a language with no installed voice', async () => {
    const { spoken, synth } = installSpeech(VOICES);
    const speech = await import('./speech');
    await speech.primeVoices();

    const ok = await speech.speakText('ഹലോ', 'ml');

    expect(ok).toBe(false);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(spoken).toHaveLength(0);
    expect(speech.voiceAvailable('ml')).toBe(false);
    expect(speech.voiceAvailable('hi')).toBe(true);
  });

  it('prefers the female Hindi voice over the male one', async () => {
    const { spoken } = installSpeech(VOICES);
    const speech = await import('./speech');
    await speech.primeVoices();

    await speech.speakText('नमस्ते', 'hi');
    expect(spoken[0]?.voice).toMatch(/Google हिन्दी/);
  });
});

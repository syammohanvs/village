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

describe('local neural voice', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses the backend voice before the browser one', async () => {
    installSpeech(VOICES);
    const blob = new Blob(['wav'], { type: 'audio/wav' });
    const speak = vi.fn(async () => blob);
    vi.doMock('./api', () => ({ api: { speak } }));
    const played: string[] = [];
    (globalThis as unknown as { Audio: unknown }).Audio = class {
      src: string;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        played.push(this.src);
        queueMicrotask(() => this.onended?.());
        return Promise.resolve();
      }
      pause() {}
    };
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:tts' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });

    const speech = await import('./speech');
    const ok = await speech.speakText('Hello', 'ml', 0.92);

    expect(ok).toBe(true);
    expect(speak).toHaveBeenCalledWith('Hello', 'ml', expect.closeTo(1.065, 3));
    expect(played).toEqual(['blob:tts']);
    vi.doUnmock('./api');
  });

  it('falls back to the browser voice when the local engine is missing', async () => {
    installSpeech(VOICES);
    vi.doMock('./api', () => ({
      api: { speak: vi.fn(async () => Promise.reject(new Error('503'))) },
    }));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:tts' });
    const speech = await import('./speech');
    const spoken: { voice: string | undefined }[] = [];
    window.speechSynthesis.speak = vi.fn((u: SpeechSynthesisUtterance) => {
      spoken.push({ voice: u.voice?.name });
      u.onend?.(new Event('end') as SpeechSynthesisEvent);
    }) as unknown as typeof window.speechSynthesis.speak;

    const ok = await speech.speakText('Hello', 'en');

    expect(ok).toBe(true);
    expect(spoken[0]?.voice).toMatch(/Zira/);
    vi.doUnmock('./api');
  });
});

describe('overlapping speech', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not let an older language start over the one now selected', async () => {
    installSpeech(VOICES);
    const played: string[] = [];
    let releaseSlow: (blob: Blob) => void = () => undefined;
    const slow = new Promise<Blob>((resolve) => {
      releaseSlow = resolve;
    });
    const speak = vi
      .fn()
      .mockImplementationOnce(() => slow)
      .mockImplementationOnce(async () => new Blob(['ml'], { type: 'audio/wav' }));
    vi.doMock('./api', () => ({ api: { speak } }));
    (globalThis as unknown as { Audio: unknown }).Audio = class {
      src: string;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        played.push(this.src);
        queueMicrotask(() => this.onended?.());
        return Promise.resolve();
      }
      pause() {}
    };
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:tts' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });

    const speech = await import('./speech');
    const english = speech.speakText('നമസ്കാരം', 'ml');
    await speech.speakText('नमस्ते', 'hi');
    // The English synthesis now finishes, after Malayalam already started.
    releaseSlow(new Blob(['en'], { type: 'audio/wav' }));
    const englishResult = await english;

    expect(englishResult).toBe(false);
    expect(played).toHaveLength(1);
    vi.doUnmock('./api');
  });
});

describe('one voice at a time', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not also start the browser voice while the local clip is still playing', async () => {
    // A long clip: onended has not fired when speakText resolves.
    const speechSynth = installSpeech(VOICES);
    const speakBrowser = speechSynth.synth.speak as unknown as ReturnType<typeof vi.fn>;
    const speak = vi.fn(async () => new Blob(['wav'], { type: 'audio/wav' }));
    vi.doMock('./api', () => ({ api: { speak } }));
    (globalThis as unknown as { Audio: unknown }).Audio = class {
      src: string;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        return Promise.resolve();
      }
      pause() {}
    };
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:tts' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });

    const speech = await import('./speech');
    const ok = await speech.speakText('നമസ്കാരം', 'ml');

    expect(ok).toBe(true);
    expect(speakBrowser).not.toHaveBeenCalled();
    vi.doUnmock('./api');
  });
});


describe('Indian English', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('reads English in the device`s Indian voice instead of the American Piper voice', async () => {
    const { synth } = installSpeech(VOICES);
    const speak = vi.fn(async () => new Blob(['wav'], { type: 'audio/wav' }));
    vi.doMock('./api', () => ({ api: { speak } }));
    (globalThis as unknown as { Audio: unknown }).Audio = class {
      src: string;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        return Promise.resolve();
      }
      pause() {}
    };
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:tts' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });

    const speech = await import('./speech');
    const ok = await speech.speakText('Hello', 'en');

    expect(ok).toBe(true);
    expect(speak).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utterance = (synth.speak as unknown as { mock: { calls: [SpeechSynthesisUtterance][] } }).mock.calls[0][0];
    expect(utterance.voice?.lang).toBe('en-IN');
    expect(utterance.voice?.name).toMatch(/Zira/);
    vi.doUnmock('./api');
  });

  it('recognises an Indian voice that is tagged with a wider English code', async () => {
    installSpeech([
      { name: 'Neerja', lang: 'en-GB', default: true, localService: true, voiceURI: 'neerja' },
      { name: 'Samantha', lang: 'en-US', default: false, localService: true, voiceURI: 'sam' },
    ]);
    const speech = await import('./speech');
    await speech.primeVoices();

    expect(speech.pickIndianEnglishVoice()?.name).toBe('Neerja');
  });

  it('falls back to the local voice when the device has no Indian English voice', async () => {
    const american: FakeVoice[] = [
      { name: 'Microsoft David - English (United States)', lang: 'en-US', default: true, localService: true, voiceURI: 'david' },
      { name: 'Samantha', lang: 'en-US', default: false, localService: true, voiceURI: 'sam' },
    ];
    installSpeech(american);
    const speak = vi.fn(async () => new Blob(['wav'], { type: 'audio/wav' }));
    vi.doMock('./api', () => ({ api: { speak } }));
    (globalThis as unknown as { Audio: unknown }).Audio = class {
      src: string;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        return Promise.resolve();
      }
      pause() {}
    };
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:tts' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });

    const speech = await import('./speech');
    const ok = await speech.speakText('Hello', 'en');

    expect(ok).toBe(true);
    // Default rate 0.98 -> length scale 1.0 (Lia asks for 0.92, which is 1.065).
    expect(speak).toHaveBeenCalledWith('Hello', 'en', expect.closeTo(1.0, 3));
    vi.doUnmock('./api');
  });
});

describe('a voice that has started is never repeated', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not re-read the sentence locally when the device voice never reports its end', async () => {
    vi.useFakeTimers();
    try {
      class FakeUtterance {
        text: string;
        lang = '';
        rate = 1;
        voice: FakeVoice | null = null;
        onstart: (() => void) | null = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
      const synth = {
        getVoices: () => VOICES,
        // Begins, then never reports the end — some engines do this for long text.
        speak: vi.fn((utterance: FakeUtterance) => {
          utterance.onstart?.();
        }),
        cancel: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
      Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance });

      const speak = vi.fn(async () => new Blob(['wav'], { type: 'audio/wav' }));
      vi.doMock('./api', () => ({ api: { speak } }));

      const speech = await import('./speech');
      const pending = speech.speakText('Hello', 'en');
      await vi.advanceTimersByTimeAsync(8000);

      // Success once the voice has begun: timing out a running sentence is not
      // a failure, and treating it as one would speak the words a second time.
      expect(await pending).toBe(true);
      expect(speak).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.doUnmock('./api');
    }
  });
});

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

  it('reads English through Piper first, not the device Indian voice', async () => {
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
    // Piper (the clean local voice) is tried first, so the device Indian
    // voice must not be used when Piper succeeds.
    expect(speak).toHaveBeenCalled();
    expect(synth.speak).not.toHaveBeenCalled();
    vi.doUnmock('./api');
  });

  it('never changes accent when the audio it already has cannot be played', async () => {
    // Reported: "she speaks fine in the same window, then when we showed the
    // leaf she read that one line in a weird accent".  Piper had answered 200
    // for every utterance, so the odd line was the DEVICE voice taking over
    // because a play() hiccup made the caller fall back.  One voice per
    // session: if Piper's audio exists, a playback failure is silence, not a
    // different accent.
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
        return Promise.reject(new Error('play() was refused'));
      }
      pause() {}
    };
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:tts' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });

    const speech = await import('./speech');
    const ok = await speech.speakText('Classified as Glass. Please contact the operator.', 'en');

    expect(ok).toBe(false);
    expect(speak).toHaveBeenCalled();
    expect(synth.speak).not.toHaveBeenCalled();
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
    // English also carries the voice choice; the server falls back to Sara's own
    // model when the Indian one is not installed.
    expect(speak).toHaveBeenCalledWith('Hello', 'en', expect.closeTo(1.0, 3), 'indian');
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

      const speak = vi.fn(async () => {
        throw new Error('piper unavailable');
      });
      vi.doMock('./api', () => ({ api: { speak } }));

      const speech = await import('./speech');
      const pending = speech.speakText('Hello', 'en');
      await vi.advanceTimersByTimeAsync(8000);

      // Piper is tried first (and fails here), then the device voice starts but
      // never reports its end.  Timing out a running sentence is not a failure,
      // and treating it as one would speak the words a second time.
      expect(await pending).toBe(true);
      expect(speak).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.doUnmock('./api');
    }
  });
});

/**
 * Sara's English can be spoken by the local neural voice (American) or by an
 * Indian-English voice installed on this computer — the exhibit asked for the
 * accent, and Windows ships "Heera" and "Ravi" for exactly this (2026-11-17).
 */
describe('English in an Indian accent', () => {
  const INDIAN = [
    { name: 'Microsoft Heera - English (India)', lang: 'en-IN', default: false, localService: true, voiceURI: 'heera' },
    { name: 'Microsoft David - English (United States)', lang: 'en-US', default: true, localService: true, voiceURI: 'david' },
  ];

  function stubPiperPlayback() {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:tts' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
    (globalThis as unknown as { Audio: unknown }).Audio = class {
      src: string;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        queueMicrotask(() => this.onended?.());
        return Promise.resolve();
      }
      pause() {}
    };
  }

  beforeEach(() => {
    vi.resetModules();
    window.localStorage.removeItem('village.englishVoice');
  });

  it('asks the local engine for the Indian voice when that is chosen', async () => {
    // The neural Indian model is the better voice; the computer's own en-IN
    // voice is only the fallback when the engine cannot produce it.
    installSpeech(INDIAN as unknown as FakeVoice[]);
    const blob = new Blob(['wav'], { type: 'audio/wav' });
    const speak = vi.fn(async () => blob);
    vi.doMock('./api', () => ({ api: { speak } }));
    stubPiperPlayback();

    const speech = await import('./speech');
    speech.saveEnglishVoiceChoice('device-india');
    const ok = await speech.speakText('Hello', 'en');

    expect(ok).toBe(true);
    expect(speak).toHaveBeenCalledWith('Hello', 'en', expect.any(Number), 'indian');
    vi.doUnmock('./api');
  });

  it('falls back to the computer’s Indian voice when the engine has no model', async () => {
    const { spoken } = installSpeech(INDIAN as unknown as FakeVoice[]);
    const speak = vi.fn(async () => Promise.reject(new Error('400')));
    vi.doMock('./api', () => ({ api: { speak } }));
    stubPiperPlayback();

    const speech = await import('./speech');
    speech.saveEnglishVoiceChoice('device-india');
    const ok = await speech.speakText('Hello', 'en');

    expect(ok).toBe(true);
    expect(spoken[0]?.voice).toMatch(/Heera/);
    vi.doUnmock('./api');
  });

  it('keeps Sara’s own voice when that is chosen', async () => {
    const { spoken } = installSpeech(INDIAN as unknown as FakeVoice[]);
    const blob = new Blob(['wav'], { type: 'audio/wav' });
    const speak = vi.fn(async () => blob);
    vi.doMock('./api', () => ({ api: { speak } }));
    stubPiperPlayback();

    const speech = await import('./speech');
    speech.saveEnglishVoiceChoice('sara');
    const ok = await speech.speakText('Hello', 'en');

    expect(ok).toBe(true);
    expect(speak).toHaveBeenCalledWith('Hello', 'en', expect.any(Number), 'sara');
    expect(spoken).toHaveLength(0);
    vi.doUnmock('./api');
  });

  it('is Indian English by default, and still speaks when nothing Indian is installed', async () => {
    // Only American English here: the choice must not switch to a US device
    // voice, which would be a third accent nobody asked for.
    installSpeech([
      { name: 'Microsoft David - English (United States)', lang: 'en-US', default: true, localService: true, voiceURI: 'david' },
    ]);
    const blob = new Blob(['wav'], { type: 'audio/wav' });
    const speak = vi.fn(async () => blob);
    vi.doMock('./api', () => ({ api: { speak } }));
    stubPiperPlayback();

    const speech = await import('./speech');
    // No explicit choice: the default is the Indian accent.
    expect(speech.loadEnglishVoiceChoice()).toBe('device-india');
    const ok = await speech.speakText('Hello', 'en');

    // The engine is asked for the Indian voice and falls back to its own model
    // when that file is missing — never to an American *device* voice.
    expect(ok).toBe(true);
    expect(speak).toHaveBeenCalledWith('Hello', 'en', expect.any(Number), 'indian');
    expect(speech.indianEnglishVoiceName()).toBeNull();
    vi.doUnmock('./api');
  });

  it('names the voice it would use, so Setup can say which one', async () => {
    installSpeech(INDIAN as unknown as FakeVoice[]);
    const speech = await import('./speech');
    await speech.primeVoices();
    expect(speech.indianEnglishVoiceName()).toMatch(/Heera/);
  });
});

/**
 * "Sara" is a name, and the English phonemiser reads it as the American
 * "SEH-ra" (/s ˈ ɛ ɹ ə/).  Our Sara is സാറ / सारा — /ˈsɑːrə/, "SAA-ra" — so the
 * engine is given "Sahra" for English only, while the page keeps the name it
 * has always shown (asked 2026-11-17).
 *
 * A sentence-final "you" is respelled the same way, for a measured reason: the
 * voice reduces an unstressed pronoun to a short vowel (140 ms, 13.3 % of the
 * sentence peak in the greeting), and `yoo` — the same sound, stressed — is
 * 200 ms at 15.9 %, i.e. a fully articulated word.  Mid-sentence "you" is an
 * ordinary unstressed pronoun and is left alone.
 */
describe('how the name is said', () => {
  beforeEach(() => {
    vi.resetModules();
    // Earlier tests leave a preference behind; this one is about the default.
    window.localStorage.removeItem('village.englishVoice');
  });

  it('spells it for the English voice and leaves the other languages alone', async () => {
    const speech = await import('./speech');

    expect(speech.spokenText('I am Sara. How may I help you?', 'en')).toBe(
      'I am Sahra. How may I help yoo?',
    );
    // Only at the end of a sentence: mid-sentence it is a normal pronoun.
    expect(speech.spokenText('Can you turn off the lights?', 'en')).toBe(
      'Can you turn off the lights?',
    );
    expect(speech.spokenText('Would you like the lights on or off?', 'en')).toBe(
      'Would you like the lights on or off?',
    );
    // A question mark is not required, and a trailing quote still counts.
    expect(speech.spokenText('The lights are for you.', 'en')).toBe('The lights are for yoo.');
    expect(speech.spokenText('It is ready for you', 'en')).toBe('It is ready for yoo');
    expect(speech.spokenText('For you?" she asked', 'en')).toBe('For yoo?" she asked');
    // Case is kept, and the possessive works with it.
    expect(speech.spokenText('SARA is here', 'en')).toBe('Sahra is here');
    expect(speech.spokenText("Sara's reply", 'en')).toBe("Sahra's reply");
    // Malayalam and Hindi write the name in their own script; nothing to fix.
    expect(speech.spokenText('ഞാൻ സാറയാണ്.', 'ml')).toBe('ഞാൻ സാറയാണ്.');
    expect(speech.spokenText('मैं सारा हूँ।', 'hi')).toBe('मैं सारा हूँ।');
    // A word that only contains it is not touched.
    expect(speech.spokenText('Sarasota', 'en')).toBe('Sarasota');
  });

  it('sends the spoken spelling to the engine, not the written one', async () => {
    installSpeech(VOICES);
    const blob = new Blob(['wav'], { type: 'audio/wav' });
    const speak = vi.fn(async () => blob);
    vi.doMock('./api', () => ({ api: { speak } }));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:tts' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
    (globalThis as unknown as { Audio: unknown }).Audio = class {
      src: string;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        queueMicrotask(() => this.onended?.());
        return Promise.resolve();
      }
      pause() {}
    };

    const speech = await import('./speech');
    await speech.speakText('I am Sara. How may I help you?', 'en');

    expect(speak).toHaveBeenCalledWith(
      'I am Sahra. How may I help yoo?',
      'en',
      expect.any(Number),
      'indian',
    );
    vi.doUnmock('./api');
  });
});

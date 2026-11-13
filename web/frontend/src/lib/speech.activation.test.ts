/**
 * What Sara does before the page has been touched.
 *
 * The browser refuses to start an audio element without a user gesture, so the
 * Piper clip that normally speaks her greeting is refused on load.  The device
 * voice is allowed, so it is tried first in exactly that case -- otherwise the
 * greeting only arrived after the visitor pressed something, which was reported
 * as "Sara speaks when I click Start camera".
 *
 * Its own file, on purpose: these tests replace `navigator.userActivation` and
 * the speech engine, and the voice-choice suite beside it must not inherit
 * either.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const speak = vi.fn();
vi.mock('./api', () => ({ api: { speak: (...args: unknown[]) => speak(...args) } }));

type FakeUtterance = { text: string; voice: unknown; lang: string };

function installSpeech() {
  const spoken: FakeUtterance[] = [];
  class Utterance {
    text: string;
    lang = '';
    rate = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onstart: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const voice = {
    name: 'Microsoft Zira - English (India)',
    lang: 'en-IN',
    default: false,
    localService: true,
    voiceURI: 'zira',
  };
  const synth = {
    getVoices: () => [voice],
    speak: vi.fn((utterance: Utterance) => {
      spoken.push({ text: utterance.text, voice: utterance.voice, lang: utterance.lang });
      utterance.onstart?.();
      utterance.onend?.();
    }),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: Utterance,
  });
  return { spoken };
}

function setActivation(active: boolean) {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: { hasBeenActive: active, isActive: active },
  });
}

describe('Sara before the first tap', () => {
  beforeEach(() => {
    speak.mockReset();
    vi.resetModules();
  });

  it('speaks with the device voice and never asks Piper', async () => {
    const { spoken } = installSpeech();
    setActivation(false);
    const { speakText } = await import('./speech');

    expect(await speakText('Know the bin? Go ahead.', 'en')).toBe(true);
    expect(spoken).toHaveLength(1);
    expect(speak).not.toHaveBeenCalled();
  });

  it('uses Piper again once there has been a gesture', async () => {
    installSpeech();
    setActivation(true);
    speak.mockResolvedValue(new Blob(['x'], { type: 'audio/wav' }));
    const { speakText } = await import('./speech');

    await speakText('Know the bin? Go ahead.', 'en');
    expect(speak).toHaveBeenCalled();
  });
});

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: vi.fn(async () => undefined),
});

Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  value: vi.fn(),
});

const mediaDevices = {
  getUserMedia: vi.fn(async () => ({
    getTracks: () => [],
    getAudioTracks: () => [],
    getVideoTracks: () => [],
  })),
  enumerateDevices: vi.fn(async () => []),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: mediaDevices,
});

if (!('MediaRecorder' in window)) {
  class FakeMediaRecorder {
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      /* no-op */
    }
    stop() {
      this.onstop?.();
    }
  }
  Object.defineProperty(window, 'MediaRecorder', {
    configurable: true,
    value: FakeMediaRecorder,
  });
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: FakeMediaRecorder,
  });
}

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
}

if (typeof window.speechSynthesis === 'undefined') {
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: () => [],
    },
  });
  class FakeUtterance {
    text: string;
    lang = '';
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: FakeUtterance,
  });
}

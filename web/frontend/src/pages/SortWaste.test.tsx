import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../lib/api';
import { makeSettings, makeState } from '../test/fixtures';

vi.mock('../lib/wasteTiming', () => ({ VISION_WAIT_MS: 500 }));

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      state: vi.fn(),
      settings: vi.fn(),
      session: vi.fn(),
      wasteCorrect: vi.fn(),
      wasteModelStatus: vi.fn(),
      wasteResnetStatus: vi.fn(),
      wasteClassify: vi.fn(),
      wasteIdentify: vi.fn(),
      wasteClear: vi.fn(),
      wasteTeach: vi.fn(),
      postRecognition: vi.fn(),
      voiceReadiness: vi.fn(),
      voiceIntents: vi.fn(),
      events: vi.fn(),
    },
  };
});

const DEFAULT_PREDICTIONS = [
  { className: 'Organic', probability: 0.01 },
  { className: 'Plastic', probability: 0.95 },
  { className: 'Paper', probability: 0.03 },
  { className: 'Glass', probability: 0.001 },
  { className: 'Metal', probability: 0.001 },
  { className: 'Textile', probability: 0.001 },
  { className: 'Leather', probability: 0.001 },
  { className: 'Footwear', probability: 0.001 },
  { className: 'Thermocol', probability: 0.001 },
  { className: 'Ewaste', probability: 0.001 },
  { className: 'Background', probability: 0.01 },
];

const TEST_LABELS = DEFAULT_PREDICTIONS.map((row) => row.className);

function predictionsFor(top: string, confidence = 0.95) {
  const rest = (1 - confidence) / (TEST_LABELS.length - 1);
  return TEST_LABELS.map((label) => ({
    className: label,
    probability: label === top ? confidence : rest,
  }));
}

const { predictionState } = vi.hoisted(() => {
  const state = {
    current: [
      { className: 'Organic', probability: 0.01 },
      { className: 'Plastic', probability: 0.95 },
      { className: 'Paper', probability: 0.03 },
      { className: 'Glass', probability: 0.001 },
      { className: 'Metal', probability: 0.001 },
      { className: 'Textile', probability: 0.001 },
      { className: 'Leather', probability: 0.001 },
      { className: 'Footwear', probability: 0.001 },
      { className: 'Thermocol', probability: 0.001 },
      { className: 'Ewaste', probability: 0.001 },
      { className: 'Background', probability: 0.01 },
    ],
  };
  return { predictionState: state };
});


// What the page asked Sara to say, in order.  The delay this pins was measured
// in the app: the sentence used to wait for the recording round trip.
const spoken: string[] = [];
const spokenLanguages: string[] = [];

vi.mock('../lib/speech', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/speech')>();
  return {
    ...actual,
    speakText: (text: string, language = 'en') => {
      spoken.push(text);
      spokenLanguages.push(language);
      return Promise.resolve();
    },
  };
});

// Every quality argument the page has passed to toDataURL since the last
// test started.  The JPEG quality is an accuracy knob (measured, see
// SortWaste.tsx), so it is worth pinning where a test can see it.
const toDataUrlCalls: unknown[] = [];

beforeEach(() => {
  vi.mocked(api.session).mockResolvedValue({
    authenticated: true,
    username: null,
    auth_enabled: false,
  });
  // Every check clears the previous lamp first.  Default to an acknowledged
  // clear; the tests that care stub their own answer.
  vi.mocked(api.wasteClear).mockClear();
  vi.mocked(api.wasteClear).mockResolvedValue({ cleared: true, confirmed: true });

  window.history.pushState({}, '', '/waste');
  // The classifier adapter draws the crop into a canvas and sends it to the
  // backend.  jsdom has no canvas implementation, so these two calls are stubbed
  // for every test; the paint-out suite installs a recording version on top.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
      drawImage() {},
      fillRect() {},
      clearRect() {},
      putImageData() {},
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      }),
      // The press reads the frame to find the object on the backdrop, so every
      // test gets a picture: a red sheet with one pale item in the middle.
      getImageData: (_x: number, _y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 190;
          data[i + 1] = 60;
          data[i + 2] = 55;
          data[i + 3] = 255;
        }
        for (let y = Math.floor(height * 0.3); y < Math.floor(height * 0.7); y += 1) {
          for (let x = Math.floor(width * 0.35); x < Math.floor(width * 0.65); x += 1) {
            const i = (y * width + x) * 4;
            data[i] = 230;
            data[i + 1] = 225;
            data[i + 2] = 215;
          }
        }
        return { data, width, height };
      },
    }),
  });
  toDataUrlCalls.length = 0;
  // A real camera reports its frame size; jsdom's video reports 0 forever, so
  // the page's new "did a picture actually arrive?" check would fail them all.
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
  spoken.length = 0;
  spokenLanguages.length = 0;
  window.localStorage.removeItem('village.voiceLanguage');
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value: (_type?: string, quality?: unknown) => {
      toDataUrlCalls.push(quality);
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    },
  });
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.events).mockResolvedValue({ events: [] });
  vi.mocked(api.settings).mockResolvedValue(makeSettings());
  vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
  vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
  vi.mocked(api.wasteResnetStatus).mockResolvedValue({
    installed: false,
    model: 'resnet50',
    classes: [],
    vision: { provider: 'cloudflare', model: '@cf/meta/llama-3.2-11b-vision-instruct', ready: true },
  });
  vi.mocked(api.wasteCorrect).mockResolvedValue({
    file: 'capture.jpg',
    actual: 'Plastic',
    saved_as: '/tmp/samples/Plastic/venue-capture.jpg',
  });
  vi.mocked(api.wasteClassify).mockImplementation(async () => ({
    model: 'resnet50',
    predictions: predictionState.current,
    file: 'Plastic/booth-1.jpg',
  }));
  vi.mocked(api.wasteTeach).mockResolvedValue({
    saved: true,
    file: 'Plastic/booth-1.jpg',
    label: 'Plastic',
  });
  predictionState.current = DEFAULT_PREDICTIONS;
});

describe('Sort Waste', () => {
  it('says the model is missing and offers the preview without guessing', async () => {
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: false,
      model: 'resnet50',
      classes: [],
      vision: { provider: null, model: null, ready: false },
    });
    render(<App />);

    expect(await screen.findByText(/Recognition model is missing/i)).toBeInTheDocument();
    expect(screen.getByText(/No item-naming service is configured/i)).toBeInTheDocument();

    // Preview is a real capability, so the button is enabled and the page says
    // plainly that no bin will be suggested.  Claiming preview while disabling
    // the button was the contradiction.
    expect(screen.getByTestId('start-camera')).toBeEnabled();
    expect(screen.queryByText(/\d+% confidence/i)).not.toBeInTheDocument();
  });

  it('names an unavailable service separately from a missing model', async () => {
    vi.mocked(api.wasteResnetStatus).mockRejectedValue(new Error('backend down'));
    render(<App />);

    expect(await screen.findByText(/Model status could not be checked/i)).toBeInTheDocument();
    expect(screen.getByText(/backend down/)).toBeInTheDocument();
  });

  it('enables the camera when the model is installed and hides tuning under details', async () => {
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: true,
      model: 'resnet50',
      classes: [],
      vision: { provider: 'cloudflare', model: 'llama', ready: true },
    });
    render(<App />);

    // Released only once the classifier is ready: pressing it into a
    // half-prepared page is what made "learning the room" look like a fault.
    const start = await screen.findByTestId('start-camera');
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
    expect(start).toHaveTextContent(/start camera/i);
    expect(screen.getByText('How it works')).toBeInTheDocument();
    expect(screen.getByText('Model details')).toBeInTheDocument();
    expect(screen.getByText(/does not identify people/i)).toBeInTheDocument();
  });

});

describe('Sort Waste — the camera waits for the model', () => {
  it('opens the camera without a naming service, but offers no check', async () => {
    // The preview is a real capability; the check is not, because there is no
    // model to ask.  The page says so instead of guessing.
    vi.mocked(api.state).mockResolvedValue(makeState());
    vi.mocked(api.events).mockResolvedValue({ events: [] });
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
    vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: false,
      model: 'resnet50',
      classes: [],
      vision: { provider: null, model: null, ready: false },
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
    });
    render(<App />);

    const start = await screen.findByTestId('start-camera');
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
    expect(await screen.findByText(/No item-naming service is configured/i)).toBeInTheDocument();
  }, 15000);
});

describe('Sort Waste — one press reads the video, not one frame', () => {
  function stubCamera() {
    vi.mocked(api.state).mockResolvedValue(makeState());
    vi.mocked(api.events).mockResolvedValue({ events: [] });
    vi.mocked(api.settings).mockResolvedValue(makeSettings({ waste_confidence: 0.5 }));
    vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
    vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: true,
      model: 'resnet50',
      classes: [],
      vision: { provider: 'cloudflare', model: 'llama', ready: true },
    });
    vi.mocked(api.postRecognition).mockClear();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => 2,
    });
  }

  function stubCanvas() {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (function () {
      return {
        drawImage() {},
        clearRect() {},
        putImageData() {},
        fillRect() {},
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
        }),
        getImageData: (_x: number, _y: number, width: number, height: number) => {
          const data = new Uint8ClampedArray(width * height * 4);
          for (let i = 0; i < data.length; i += 4) {
            data[i] = 60;
            data[i + 1] = 60;
            data[i + 2] = 60;
            data[i + 3] = 255;
          }
          return { data, width, height };
        },
      };
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    return original;
  }

  it('draws the square that will be read, sized from the camera', async () => {
    // Reported: a bottle held at the edge of the picture read as paper, then
    // glass.  Two things caused it, and this is the first: the preview was a
    // fixed 4:3 box with `object-fit: cover`, so a 16:9 camera's side edges
    // were hidden -- the item could be in shot and not on screen.  The frame
    // now takes the camera's shape, and the square that will be classified is
    // drawn on it, from the same number the crop uses.
    stubCamera();
    const originalWidth = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth');
    const originalHeight = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight');
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 360 });
    const original = stubCanvas();
    try {
      render(<App />);
      const start = await screen.findByTestId('start-camera');
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);

      const video = document.querySelector('video');
      expect(video).not.toBeNull();
      fireEvent.loadedMetadata(video as HTMLVideoElement);

      const guide = await screen.findByTestId('crop-guide');
      // 0.8 of the short side: 80% tall, and 45% wide on a 16:9 camera.
      // (jsdom prints "80%" for "80.00%", so compare the numbers.)
      expect(parseFloat(guide.style.height)).toBeCloseTo(80, 2);
      expect(parseFloat(guide.style.width)).toBeCloseTo(45, 2);
      // The frame is the camera's shape, so nothing is cropped out of view.
      const frame = (video as HTMLVideoElement).closest('.camera-frame') as HTMLElement;
      expect(frame.getAttribute('style') ?? '').toContain('aspect-ratio');
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
      if (originalWidth) Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', originalWidth);
      if (originalHeight) Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', originalHeight);
    }
  }, 20000);

  it('reads one frame and makes one decision', async () => {
    // The local classifier needed three frames to settle.  It is gone: a press
    // takes one picture, the hosted model names it once, and the page records
    // one recognition.
    stubCamera();
    vi.mocked(api.wasteIdentify).mockResolvedValue({
      object: 'clear plastic bag',
      provider: 'cloudflare',
      model: 'llama',
      ms: 900,
    });
    const original = stubCanvas();
    try {
      render(<App />);
      const start = await screen.findByTestId('start-camera');
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);
      fireEvent.click(await screen.findByTestId('classify-now'));

      await waitFor(() => expect(api.postRecognition).toHaveBeenCalledTimes(1), { timeout: 10000 });
      expect(vi.mocked(api.wasteIdentify).mock.calls).toHaveLength(1);
      const body = vi.mocked(api.postRecognition).mock.calls[0][0];
      expect(body).toMatchObject({ category: 'plastic' });
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  }, 30000);
});

describe('Sort Waste — nothing is classified unless it is asked for', () => {
  it('speaks the sentence in the language chosen in Setup', async () => {
    // Malayalam is set in Setup, so the answer must be Malayalam -- the page used
    // to hardcode English here whatever the setting said (reported 2026-11-16).
    window.localStorage.setItem('village.voiceLanguage', 'ml');
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: false,
      model: 'resnet50',
      classes: [],
      vision: { provider: 'cloudflare', model: 'llama', ready: true },
    });
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'plastic',
      recognition: { id: 11, category: 'plastic', confidence: 0.95 },
    });
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream), enumerateDevices: vi.fn().mockResolvedValue([]) },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => 2,
    });
    vi.mocked(api.wasteIdentify).mockResolvedValue({
      object: 'clear plastic bag',
      object_local: 'സുതാര്യമായ പ്ലാസ്റ്റിക് ബാഗ്',
      provider: 'cloudflare',
      model: 'llama',
      ms: 900,
    });

    render(<App />);
    const startButton = await screen.findByTestId('start-camera');
    await waitFor(() => expect(startButton).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(startButton);
    fireEvent.click(await screen.findByTestId('classify-now'));

    await waitFor(() => expect(spoken.length).toBeGreaterThan(0), { timeout: 8000 });
    expect(spokenLanguages).toContain('ml');
    // The sentence itself is Malayalam, not English text read by a Malayalam voice.
    expect(spoken.some((line) => /പ്ലാസ്റ്റിക്/.test(line))).toBe(true);
    // And the name is the translated one: an English noun inside a Malayalam
    // sentence is what a Malayalam voice then mispronounces.
    const line = spoken.join(' ');
    expect(line).toContain('സുതാര്യമായ');
    expect(line).not.toMatch(/clear plastic bag/i);
  });

  it('leaves the English name out of the spoken sentence when it cannot be translated', async () => {
    // Better a sentence without the name than an English noun read by a
    // Malayalam voice.
    window.localStorage.setItem('village.voiceLanguage', 'ml');
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream), enumerateDevices: vi.fn().mockResolvedValue([]) },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true, value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true, get: () => 2,
    });
    vi.mocked(api.wasteIdentify).mockResolvedValue({
      object: 'mystery widget', provider: 'cloudflare', model: 'llama', ms: 900,
    });

    render(<App />);
    const startButton = await screen.findByTestId('start-camera');
    await waitFor(() => expect(startButton).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(startButton);
    fireEvent.click(await screen.findByTestId('classify-now'));

    await waitFor(() => expect(spoken.length).toBeGreaterThan(0), { timeout: 8000 });
    const line = spoken.join(' ');
    expect(line).not.toMatch(/mystery widget/i);
    expect(line).toMatch(/പ്ലാസ്റ്റിക്|ജൈവ|പേപ്പർ/);
  });
  it('does not offer the camera while the controller is offline', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream), enumerateDevices: vi.fn().mockResolvedValue([]) },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => 2,
    });
    // The model is installed, so the ONLY reason left for the button being off
    // is the board being unreachable.
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: true,
      model: 'resnet50',
      classes: [],
      vision: { provider: 'cloudflare', model: 'llama', ready: true },
    });
    vi.mocked(api.state).mockResolvedValue(makeState({ connected: false }));
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('start-camera')).toBeDisabled());
    expect(screen.getByTestId('waste-offline')).toHaveTextContent(/Simulation/);
  });

  it('offers the camera in Simulation mode even with no board', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream), enumerateDevices: vi.fn().mockResolvedValue([]) },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => 2,
    });
    window.localStorage.setItem('village.demoMode', 'demo');
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: true,
      model: 'resnet50',
      classes: [],
      vision: { provider: 'cloudflare', model: 'llama', ready: true },
    });
    vi.mocked(api.state).mockResolvedValue(makeState({ connected: false }));
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('start-camera')).toBeEnabled());
    expect(screen.queryByTestId('waste-offline')).not.toBeInTheDocument();
  });
});

/** A camera that answers every call, including the device list the panel asks
 *  for on mount (a leftover stub can leave that promise undefined). */
function stubCamera() {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });
}

describe('Sort Waste — the three bin lamps, in simulation', () => {
  it('lights the bin the controller was told to indicate, and nothing else', async () => {
    // A classification sends INDICATE_WASTE and the demo device holds that
    // category for a few seconds.  The panel reads the frame's own
    // waste_indicator, so these are the lamps the board would be showing.
    window.localStorage.setItem('village.demoMode', 'demo');
    window.history.pushState({}, '', '/waste');
    vi.mocked(api.state).mockResolvedValue(makeState({ wasteCategory: 'plastic' }));
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: true,
      model: 'resnet50',
      classes: [],
      vision: { provider: 'cloudflare', model: 'llama', ready: true },
    });
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    stubCamera();
    render(<App />);

    const leds = await screen.findByTestId('bin-leds');
    // The first village frame lands a tick after the panel mounts.
    await waitFor(
      () => expect(within(leds).getByTestId('bin-led-plastic')).toHaveClass('is-on'),
      { timeout: 4000 },
    );
    expect(within(leds).getByTestId('bin-led-organic')).not.toHaveClass('is-on');
    expect(within(leds).getByTestId('bin-led-paper')).not.toHaveClass('is-on');
    expect(leds).toHaveAttribute('data-active', 'plastic');
  });

  it('leaves all three off before anything has been put in a bin', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    window.history.pushState({}, '', '/waste');
    vi.mocked(api.state).mockResolvedValue(makeState({ wasteCategory: null }));
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: true,
      model: 'resnet50',
      classes: [],
      vision: { provider: 'cloudflare', model: 'llama', ready: true },
    });
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    stubCamera();
    render(<App />);

    const leds = await screen.findByTestId('bin-leds');
    for (const bin of ['organic', 'plastic', 'paper']) {
      expect(within(leds).getByTestId(`bin-led-${bin}`)).not.toHaveClass('is-on');
    }
    expect(leds).toHaveTextContent(/no bin led is lit/i);
  });
});

/**
 * Choosing the camera.  An exhibit laptop usually has a built-in camera and an
 * external one on a USB lead; the browser's default is the built-in one, so the
 * page has to offer the choice, keep it, and notice a camera plugged in after it
 * was opened (asked 2026-11-17: "I connected an external webcam via USB, how can
 * I select that cam in the app?").
 */
describe('Sort Waste — choosing the camera', () => {
  const KEY = 'village.cameraDevice';

  function stubCameras(initial: { deviceId: string; label: string }[]) {
    let current = initial;
    const listeners = new Set<() => void>();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
        enumerateDevices: vi.fn(async () =>
          current.map((device) => ({ ...device, kind: 'videoinput' })) as unknown as MediaDeviceInfo[],
        ),
        addEventListener: (event: string, listener: () => void) => {
          if (event === 'devicechange') listeners.add(listener);
        },
        removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
      },
    });
    return {
      plugIn: (next: { deviceId: string; label: string }[]) => {
        current = next;
        listeners.forEach((listener) => listener());
      },
    };
  }

  beforeEach(() => {
    window.localStorage.removeItem(KEY);
    window.history.pushState({}, '', '/waste');
    vi.mocked(api.state).mockResolvedValue(makeState());
    vi.mocked(api.events).mockResolvedValue({ events: [] });
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: true,
      model: 'resnet50',
      classes: [],
      vision: { provider: 'cloudflare', model: 'llama', ready: true },
    });
  });

  it('lists every camera and remembers the one chosen', async () => {
    stubCameras([
      { deviceId: 'built-in', label: 'Integrated Webcam' },
      { deviceId: 'usb-cam', label: 'USB Camera' },
    ]);
    render(<App />);

    const select = await screen.findByTestId('camera-device');
    await waitFor(() => expect(within(select).getByText('USB Camera')).toBeInTheDocument());
    // The default option stays first: "whatever the browser picks".
    expect(within(select).getByText('Default camera')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'usb-cam' } });
    expect(select).toHaveValue('usb-cam');
    expect(window.localStorage.getItem(KEY)).toBe('usb-cam');
  });

  it('opens on the camera chosen last time', async () => {
    window.localStorage.setItem(KEY, 'usb-cam');
    stubCameras([
      { deviceId: 'built-in', label: 'Integrated Webcam' },
      { deviceId: 'usb-cam', label: 'USB Camera' },
    ]);
    render(<App />);

    const select = await screen.findByTestId('camera-device');
    await waitFor(() => expect(select).toHaveValue('usb-cam'));
  });

  it('offers a camera plugged in while the page is open, without a reload', async () => {
    const media = stubCameras([{ deviceId: 'built-in', label: 'Integrated Webcam' }]);
    render(<App />);

    const select = await screen.findByTestId('camera-device');
    await waitFor(() => expect(within(select).getByText('Integrated Webcam')).toBeInTheDocument());
    expect(within(select).queryByText('USB Camera')).not.toBeInTheDocument();

    act(() => {
      media.plugIn([
        { deviceId: 'built-in', label: 'Integrated Webcam' },
        { deviceId: 'usb-cam', label: 'USB Camera' },
      ]);
    });

    await waitFor(() => expect(within(select).getByText('USB Camera')).toBeInTheDocument());
  });

  it('says how the names appear before the page may use a camera', async () => {
    stubCameras([{ deviceId: 'opaque-id', label: '' }]);
    render(<App />);

    const select = await screen.findByTestId('camera-device');
    await waitFor(() => expect(within(select).getByText('Camera 1')).toBeInTheDocument());
    expect(await screen.findByTestId('camera-labels-hint')).toHaveTextContent(
      /allowed to use a camera once/i,
    );
  });
});

/**
 * A canvas with a picture in it.
 *
 * The press reads the frame to find the object on the backdrop and crops it
 * through a canvas, so jsdom needs `getImageData` as well as `drawImage`.
 * Returns a restore function.
 */
function stubCanvasWithPicture(): () => void {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (function () {
    return {
      drawImage() {},
      clearRect() {},
      putImageData() {},
      fillRect() {},
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      }),
      getImageData: (_x: number, _y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 190;
          data[i + 1] = 60;
          data[i + 2] = 55;
          data[i + 3] = 255;
        }
        for (let y = Math.floor(height * 0.3); y < Math.floor(height * 0.7); y += 1) {
          for (let x = Math.floor(width * 0.35); x < Math.floor(width * 0.65); x += 1) {
            const i = (y * width + x) * 4;
            data[i] = 230;
            data[i + 1] = 225;
            data[i + 2] = 215;
          }
        }
        return { data, width, height };
      },
    };
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return () => {
    HTMLCanvasElement.prototype.getContext = original;
  };
}

describe('Sort Waste — two models, one decision', () => {
  type Options = {
    predictions: { className: string; probability: number }[];
    object?: string | null;
    vision?: boolean;
    identify?: (image: string) => Promise<unknown>;
    record?: unknown;
    /** Override what the board says about the start-of-check clear. */
    clear?: { cleared: boolean; confirmed: boolean; note?: string | null };
    /** Hold the clear open, to prove the lamp waits for it. */
    clearDeferred?: Promise<{ cleared: boolean; confirmed: boolean }>;
    /** Override the model-status answer, e.g. to carry a provider chain. */
    status?: {
      installed: boolean;
      model: string;
      classes: string[];
      vision?: {
        provider: string | null;
        model: string | null;
        ready: boolean;
        chain?: number;
        attempts?: Array<{ provider: string; model: string }>;
      };
    };
  };

  async function press(options: Options): Promise<() => void> {
    const vision = options.vision !== false;
    vi.mocked(api.wasteClear).mockClear();
    if (options.clearDeferred) {
      vi.mocked(api.wasteClear).mockReturnValue(options.clearDeferred);
    } else {
      vi.mocked(api.wasteClear).mockResolvedValue(
        options.clear ?? { cleared: true, confirmed: true },
      );
    }
    vi.mocked(api.wasteResnetStatus).mockResolvedValue(
      options.status ?? {
        installed: true,
        model: 'resnet50',
        classes: [],
        ...(vision
          ? { vision: { provider: 'cloudflare', model: '@cf/meta/llama-3.2-11b-vision-instruct', ready: true } }
          : {}),
      },
    );
    vi.mocked(api.wasteIdentify).mockImplementation(
      (options.identify as never) ??
        (async () => ({
          object: options.object ?? null,
          provider: 'cloudflare',
          model: '@cf/meta/llama-3.2-11b-vision-instruct',
          ms: 900,
        })),
    );
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    vi.mocked(api.postRecognition).mockClear();
    vi.mocked(api.postRecognition).mockResolvedValue(
      (options.record as never) ?? {
        ok: true,
        category: 'plastic',
        recognition: { id: 21, category: 'plastic', confidence: 0.9 },
      },
    );
    predictionState.current = options.predictions;
    stubCamera();
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => 2,
    });
    const restore = stubCanvasWithPicture();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('start-camera')).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(screen.getByTestId('start-camera'));
    fireEvent.click(await screen.findByTestId('classify-now'));
    // The start-of-check clear answers on its own microtask; flushing it here
    // keeps every later state update inside act() instead of after the test.
    await act(async () => undefined);
    return restore;
  }

  const plasticAt = (p: number) => predictionsFor('Plastic', p);

  it('shows each model separately, and the action last', async () => {
    const restore = await press({ predictions: plasticAt(0.95), object: 'clear plastic lid' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      const identifies = screen.getByTestId('waste-identify');
      const classifies = screen.getByTestId('waste-classify');
      const action = screen.getByTestId('waste-action');

      expect(within(identifies).getByTestId('waste-sees')).toHaveTextContent(
        /clear plastic lid/i,
      );
      expect(within(identifies).getByText(/cloud vision model/i)).toBeInTheDocument();
      expect(within(classifies).getByTestId('waste-result')).toHaveTextContent(/^Plastic/i);
      // The name decided, so the row says so; the local model's own answer is
      // in the details rather than being presented as the category.
      expect(within(classifies).getByText(/from the item name/i)).toBeInTheDocument();
      expect(action).toHaveTextContent(/Suggested action/i);
      expect(action).toHaveTextContent(/plastic bin/i);

      // Identification, then classification, then the action — the order a
      // person checks an answer in.
      expect(identifies.compareDocumentPosition(classifies) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(classifies.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // Only an accepted bin decision asks for a lamp.
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({
        category: 'plastic',
        // The record says what happened: the hosted name, which service gave it,
        // the route, and that the name decided.  The classifier's own number is
        // kept as the classifier's, not as a confidence in this answer.
        item: 'clear plastic lid',
        namer: '@cf/meta/llama-3.2-11b-vision-instruct',
        route: 'bin.plastic',
        source: 'vision',
        model: 'resnet50',
        material: 'Plastic',
        confidence: 0.95,
      });
      const payload = vi.mocked(api.postRecognition).mock.calls[0][0];
      expect(payload.top?.[0]).toMatchObject({ className: 'Plastic', probability: 0.95 });
      expect(payload.top).toHaveLength(3);
    } finally {
      restore();
    }
  }, 25000);

  it('refuses a bin for a pencil, whatever the picture says', async () => {
    // The reported shape: a pencil read as Paper 93%.  The name now decides the
    // category, and a pencil is in none of the three bins.
    const restore = await press({ predictions: predictionsFor('Paper', 0.93), object: 'orange pencil' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      const action = screen.getByTestId('waste-action');
      expect(action).toHaveTextContent(/keep this item separate/i);
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'other' });
    } finally {
      restore();
    }
  }, 25000);

  it('does not add e-waste to metal to reach a threshold', async () => {
    const predictions = predictionsFor('Ewaste', 0.45).map((row) =>
      row.className === 'Metal' ? { ...row, probability: 0.35 } : row,
    );
    // No name here: the sum is not allowed to make it a confident recyclable.
    const restore = await press({ predictions, object: null });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      const action = screen.getByTestId('waste-action');
      expect(action).toHaveTextContent(/identification unavailable|keep this item separate/i);
      expect(action).not.toHaveTextContent(/recycling agent/i);
      expect(screen.getByTestId('waste-result')).toHaveTextContent(/not certain/i);
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'other' });
    } finally {
      restore();
    }
  }, 25000);

  it('answers a low e-waste reading when the name agrees — the 0.40 remote', async () => {
    // The exhibit's own item (2026-11-19): a black car remote at Ewaste 0.40.
    // The name "remote control" corroborates the class, so the page answers the
    // e-waste collection instead of "not sure" — no lamp either way.
    const restore = await press({ predictions: predictionsFor('Ewaste', 0.4), object: 'remote control' });
    try {
      // The category is still electronic waste; the visitor's instruction is the
      // one ordinary referral sentence, plus the handling line e-waste needs.
      await waitFor(
        () => expect(screen.getByTestId('waste-action')).toHaveTextContent(
          /further sorting, collection and recycling instructions/i,
        ),
        { timeout: 8000 },
      );
      expect(screen.getByTestId('waste-result')).toHaveTextContent(/^Electronic waste/i);
      expect(screen.getByTestId('waste-ewaste-handling')).toHaveTextContent(/whole item/i);
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'other' });
    } finally {
      restore();
    }
  }, 25000);

  it('sends a confident e-waste item to its own collection, not a bin', async () => {
    const restore = await press({ predictions: predictionsFor('Ewaste', 0.88), object: 'remote control' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      const action = screen.getByTestId('waste-action');
      expect(action).toHaveTextContent(/further sorting, collection and recycling instructions/i);
      expect(screen.getByTestId('waste-ewaste-handling')).toBeInTheDocument();
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'other' });
    } finally {
      restore();
    }
  }, 25000);

  it('falls back to the offline model when the namer does not answer', async () => {
    // The internet went, or the model timed out.  The local model has been
    // learning the booth's own items for exactly this, so it answers — and the
    // card says the name was unavailable rather than pretending otherwise.
    const restore = await press({ predictions: plasticAt(0.95), object: null });
    try {
      await waitFor(
        () => expect(screen.getByTestId('waste-action')).toHaveTextContent(/plastic bin/i),
        { timeout: 8000 },
      );
      expect(within(screen.getByTestId('waste-identify')).getByTestId('waste-sees')).toHaveTextContent(
        /identification unavailable/i,
      );
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'plastic' });
    } finally {
      restore();
    }
  }, 25000);

  it('asks a person when neither model can name it', async () => {
    // No name and a local reading under its bar: nothing to act on.
    const restore = await press({ predictions: plasticAt(0.55), object: null });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      expect(screen.getByTestId('waste-action')).toHaveTextContent(/keep this item separate/i);
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'other' });
    } finally {
      restore();
    }
  }, 25000);
  it('offers no check at all when no naming service is configured', async () => {
    // There is no local classifier any more, so a deployment with no key can
    // open the camera but cannot answer — and it says so instead of guessing.
    stubCamera();
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: false, model: 'resnet50', classes: [] });
    render(<App />);
    const start = await screen.findByTestId('start-camera');
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(start);
    expect(await screen.findByTestId('classify-now')).toBeDisabled();
    expect(api.wasteIdentify).not.toHaveBeenCalled();
  }, 25000);
  it('refuses a bin under the bar when the name does not back it up', async () => {
    const restore = await press({ predictions: plasticAt(0.55), object: 'white bottle' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      const action = screen.getByTestId('waste-action');
      expect(action).toHaveTextContent(/keep this item separate/i);
      expect(screen.getByTestId('waste-result')).toHaveTextContent(/not certain/i);
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'other' });
    } finally {
      restore();
    }
  }, 25000);

  it('believes the item name over the classifier — the clear plastic bag', async () => {
    // Reported 2026-11-19: "Clear plastic bag" named correctly while the local
    // model said Paper.  The name is the answer and the bag goes in the plastic
    // bin; the classifier's reading stays visible in the details.
    const restore = await press({
      predictions: predictionsFor('Paper', 0.78),
      object: 'Clear plastic bag',
    });
    try {
      await waitFor(
        () => expect(screen.getByTestId('waste-action')).toHaveTextContent(/plastic bin/i),
        { timeout: 8000 },
      );
      expect(screen.getByTestId('waste-result')).toHaveTextContent(/^Plastic/i);
      expect(screen.getByText(/from the item name/i)).toBeInTheDocument();
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'plastic' });
    } finally {
      restore();
    }
  }, 25000);

  it('opens the bin when the name agrees — the business card', async () => {
    // Reported 2026-11-19: "White paper with red and black text" and the local
    // model on Paper, but under 0.70, so the page asked a person about a card.
    const restore = await press({
      predictions: predictionsFor('Paper', 0.61),
      object: 'White paper with red and black text',
    });
    try {
      await waitFor(
        () => expect(screen.getByTestId('waste-action')).toHaveTextContent(/paper/i),
        { timeout: 8000 },
      );
      expect(screen.getByTestId('waste-action')).toHaveTextContent(/paper & cardboard bin/i);
      expect(screen.getByTestId('waste-result')).toHaveTextContent(/^Paper/i);
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'paper' });
    } finally {
      restore();
    }
  }, 25000);

  it('speaks the label, the category and the path, once', async () => {
    const restore = await press({ predictions: plasticAt(0.95), object: 'clear plastic lid' });
    try {
      await screen.findByTestId('waste-action', {}, { timeout: 8000 });
      await waitFor(
        () => expect(spoken.filter((line) => /plastic bin/i.test(line))).toHaveLength(1),
        { timeout: 6000 },
      );
      const line = spoken.find((text) => /plastic bin/i.test(text)) ?? '';
      // "This is clear plastic lid. It is Plastic. Use the Plastic & cardboard
      // bin." — the visitor hears what it is before where it goes.
      expect(line).toMatch(/this is clear plastic lid/i);
      expect(line).toMatch(/it is plastic/i);
      expect(line).toMatch(/plastic bin/i);
    } finally {
      restore();
    }
  }, 25000);

  it('waits with the two sentences a visitor reads before pressing', async () => {
    stubCamera();
    render(<App />);
    await screen.findByTestId('waste-waiting', {}, { timeout: 8000 });
    expect(screen.getByTestId('waste-waiting')).toHaveTextContent(/waiting for an item/i);
    expect(screen.getByText(/know the bin\? go ahead/i)).toBeInTheDocument();
    expect(screen.getByTestId('waste-press-hint')).toHaveTextContent(
      /nothing is classified until you do/i,
    );
    // The item is placed on the base now, not held up in front of the camera.
    expect(screen.getByTestId('waste-press-hint')).toHaveTextContent(
      /place one item on the marked base/i,
    );
    expect(screen.getByText('Suggested bin')).toBeInTheDocument();
    // Nothing has been asked of either model.
    expect(api.wasteIdentify).not.toHaveBeenCalled();
    expect(api.postRecognition).not.toHaveBeenCalled();
  }, 25000);

  it('teaches the offline model the item the name gave', async () => {
    // Every named press is a training photo for the fallback model: the crop,
    // under the class the name implied.  Fire-and-forget, so the press is never
    // held up by it.
    vi.mocked(api.wasteTeach).mockResolvedValue({ saved: true, file: 'Plastic/booth-1.jpg', label: 'Plastic' });
    const restore = await press({ predictions: plasticAt(0.4), object: 'clear plastic bag' });
    try {
      await waitFor(() => expect(api.wasteTeach).toHaveBeenCalled(), { timeout: 8000 });
      const [image, label, said] = vi.mocked(api.wasteTeach).mock.calls[0];
      expect(String(image)).toMatch(/^data:image\/jpeg/);
      expect(label).toBe('Plastic');
      expect(said).toBe('clear plastic bag');
    } finally {
      restore();
    }
  }, 25000);

  it('files nothing for an item the name placed in none of the bins', async () => {
    // A pencil is wood, graphite and clay: the name said so, and it is not one of
    // the eleven classes the offline model can be taught.  The classifier's own
    // guess must not be written back as if the name had named it — that taught
    // ResNet50 "a pencil is plastic" once per press.
    vi.mocked(api.wasteTeach).mockClear();
    const restore = await press({ predictions: plasticAt(0.72), object: 'red pencil with a blue eraser' });
    try {
      await screen.findByTestId('waste-waiting', {}, { timeout: 8000 }).catch(() => undefined);
      await waitFor(() => expect(screen.getByTestId('waste-sees')).toHaveTextContent(/red pencil/i), {
        timeout: 8000,
      });
      expect(api.wasteTeach).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  }, 25000);

  it('shows the crop it analysed, and says so when it fell back to the centre', async () => {
    const restore = await press({ predictions: plasticAt(0.96), object: 'clear plastic lid' });
    try {
      const crop = await screen.findByTestId('waste-crop', {}, { timeout: 8000 });
      expect(crop.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/jpeg/);
      // The stub paints a red sheet with a pale item, so the backdrop crop is
      // used and the centre fallback is not claimed.
      expect(screen.queryByTestId('waste-crop-centre')).not.toBeInTheDocument();
    } finally {
      restore();
    }
  }, 25000);

  it('ignores a late name that arrives after the decision', async () => {
    let release: ((value: unknown) => void) | null = null;
    const restore = await press({
      predictions: plasticAt(0.95),
      identify: () =>
        new Promise((resolve) => {
          release = resolve;
        }) as never,
    });
    try {
      // The cap passed with no name, so the offline model answered.
      await waitFor(
        () => expect(screen.getByTestId('waste-action')).toHaveTextContent(/plastic bin/i),
        { timeout: 12000 },
      );
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'plastic' });

      await act(async () => {
        release?.({ object: 'orange pencil', provider: 'cloudflare', model: 'llama', ms: 9000 });
      });
      // The late answer must not change the action or the record.
      expect(screen.getByTestId('waste-action')).toHaveTextContent(/plastic bin/i);
      expect(vi.mocked(api.postRecognition).mock.calls).toHaveLength(1);
      // Nor the visitor-facing name: it is operator detail only, inside the
      // collapsed Model details.
      expect(screen.getByTestId('waste-sees')).toHaveTextContent(/unavailable/i);
      expect(screen.getByTestId('waste-late-name')).toHaveTextContent(/orange pencil/i);
      expect(screen.getByTestId('waste-late-name')).toHaveTextContent(/was not changed/i);
    } finally {
      restore();
    }
  }, 30000);

  it('records a special-care item as hazardous waste, never as a bin', async () => {
    // The refusal is a different outcome from a referral: the page posts
    // `medical`, the backend answers with the hazardous sentence, and no bin
    // command is sent — a battery must not light a lamp.
    const restore = await press({ predictions: plasticAt(0.9), object: 'used AA battery' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({
        category: 'medical',
        route: 'separate.unknown',
        source: 'vision',
        item: 'used AA battery',
      });
      expect(screen.getByTestId('waste-action')).toHaveTextContent(/gram sahayak/i);
    } finally {
      restore();
    }
  }, 25000);

  it('names both services, and the whole chain, in Model details', async () => {
    // The redundancy is a fact a presenter may have to explain: the Cloudflare
    // model, the same model on a second account, DeepSeek as the last resort,
    // and ResNet50 on this laptop when no name comes back.
    const restore = await press({
      predictions: plasticAt(0.9),
      object: 'clear plastic bottle',
      status: {
        installed: true,
        model: 'resnet50',
        classes: [],
        vision: {
          provider: 'cloudflare',
          model: '@cf/meta/llama-3.2-11b-vision-instruct',
          ready: true,
          chain: 3,
          attempts: [
            { provider: 'cloudflare', model: '@cf/meta/llama-3.2-11b-vision-instruct' },
            { provider: 'cloudflare', model: '@cf/meta/llama-3.2-11b-vision-instruct' },
            { provider: 'opencode', model: 'deepseek-v4.1-flash' },
          ],
        },
      },
    });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      const details = screen.getByTestId('waste-details');
      expect(within(details).getByTestId('waste-details-namer')).toHaveTextContent(
        /@cf\/meta\/llama-3\.2-11b-vision-instruct/,
      );
      expect(within(details).getByTestId('waste-details-classifier')).toHaveTextContent(/resnet50/i);
      // Each model is named once, in the order it is tried.
      const chain = within(details).getByTestId('waste-details-chain');
      expect(chain).toHaveTextContent(
        /@cf\/meta\/llama-3\.2-11b-vision-instruct → deepseek-v4\.1-flash/,
      );
    } finally {
      restore();
    }
  }, 25000);

  it('clears the previous lamp before it asks for a new one', async () => {
    // A check starts by putting the last item's LED out, and that clear has to
    // land before this check's own lamp command — otherwise a fast answer could
    // be undone by the clear that started it.
    const restore = await press({ predictions: plasticAt(0.95), object: 'clear plastic bottle' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      expect(api.wasteClear).toHaveBeenCalledTimes(1);
      const [requestId] = vi.mocked(api.wasteClear).mock.calls[0];
      expect(String(requestId)).toMatch(/^clear-\d+-/);
      expect(vi.mocked(api.wasteClear).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(api.postRecognition).mock.invocationCallOrder[0],
      );
    } finally {
      restore();
    }
  }, 25000);

  it('says so in the details when the board refuses the clear, and still answers', async () => {
    const restore = await press({
      predictions: plasticAt(0.95),
      object: 'clear plastic bottle',
      clear: {
        cleared: false,
        confirmed: false,
        note: 'Bin indicator not cleared: the controller is unreachable.',
      },
    });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      // The answer is not held hostage by a lamp.
      expect(screen.getByTestId('waste-action')).toHaveTextContent(/plastic bin/i);
      expect(screen.getByTestId('waste-clear-note')).toHaveTextContent(/not cleared/i);
    } finally {
      restore();
    }
  }, 25000);

  it('falls back to the classifier when the name has nothing usable — "container"', async () => {
    // A name with no special-care cue, no object route and no recognised
    // material is not a refusal: the classifier's own thresholds decide.
    const restore = await press({ predictions: plasticAt(0.9), object: 'container' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      expect(screen.getByTestId('waste-result')).toHaveTextContent(/^Plastic/i);
      expect(within(screen.getByTestId('waste-classify')).getByText(/local resnet50/i)).toBeInTheDocument();
      expect(screen.getByTestId('waste-action')).toHaveTextContent(/plastic bin/i);
      const payload = vi.mocked(api.postRecognition).mock.calls[0][0];
      expect(payload).toMatchObject({
        category: 'plastic',
        route: 'bin.plastic',
        source: 'local',
        item: 'container',
      });
    } finally {
      restore();
    }
  }, 25000);

  it('gives an ordinary referral one sentence, and no bin', async () => {
    // Glass, metal, cloth, leather, footwear, thermocol, pencils … all reach the
    // visitor as this one sentence.  The material stays in the classification.
    const restore = await press({ predictions: predictionsFor('Glass', 0.9), object: 'glass jar' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      expect(screen.getByTestId('waste-action')).toHaveTextContent(
        'Keep this item separate and contact the Gram Sahayak office for further sorting, collection and recycling instructions.',
      );
      expect(screen.getByTestId('waste-result')).toHaveTextContent(/^Glass/i);
      // No e-waste line, and no bin lamp.
      expect(screen.queryByTestId('waste-ewaste-handling')).not.toBeInTheDocument();
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({
        category: 'other',
        route: 'collect.glass',
      });
    } finally {
      restore();
    }
  }, 25000);

  it('gives a special-care item its own sentence, never the ordinary one', async () => {
    const restore = await press({ predictions: plasticAt(0.92), object: 'used syringe' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      const action = screen.getByTestId('waste-action');
      expect(action).toHaveTextContent(
        'This item needs special handling. Keep it separate and contact the Gram Sahayak office for collection instructions.',
      );
      // The two referrals must not bleed into each other: no "recycling
      // instructions" for a syringe, and no bin.
      expect(action).not.toHaveTextContent(/recycling instructions/i);
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'medical' });
    } finally {
      restore();
    }
  }, 25000);

  it('records the provider that actually named the item, not the one configured', async () => {
    // Workers AI out of quota, DeepSeek answered.  The record and the details
    // must say DeepSeek — attributing a fallback answer to Cloudflare is a
    // provenance lie that makes a venue session unreadable afterwards.
    vi.mocked(api.wasteTeach).mockClear();
    const restore = await press({
      predictions: plasticAt(0.9),
      identify: (async () => ({
        object: 'clear plastic bottle',
        provider: 'opencode',
        model: 'deepseek-v4.1-flash',
        ms: 9000,
      })) as never,
    });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      expect(screen.getByTestId('waste-details-namer')).toHaveTextContent(
        /deepseek-v4\.1-flash \(opencode\)/,
      );
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({
        namer: 'deepseek-v4.1-flash',
      });
      // The training record says which model named it too.
      expect(vi.mocked(api.wasteTeach).mock.calls[0][3]).toBe('deepseek-v4.1-flash');
    } finally {
      restore();
    }
  }, 25000);

  it('waits for the clear before asking the board for a lamp', async () => {
    // The old test resolved the clear immediately, so removing `await clearing`
    // would not have failed it.  This one holds the clear open: the recognition
    // must not be posted until it answers.
    let releaseClear!: (value: { cleared: boolean; confirmed: boolean }) => void;
    const clearDeferred = new Promise<{ cleared: boolean; confirmed: boolean }>((resolve) => {
      releaseClear = resolve;
    });
    const restore = await press({
      predictions: plasticAt(0.95),
      object: 'clear plastic bottle',
      clearDeferred,
    });
    try {
      // The decision is made and on screen while the clear is still pending.
      await waitFor(
        () => expect(screen.getByTestId('waste-action')).toHaveTextContent(/plastic bin/i),
        { timeout: 8000 },
      );
      expect(api.postRecognition).not.toHaveBeenCalled();

      await act(async () => {
        releaseClear({ cleared: true, confirmed: true });
      });
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'plastic' });
    } finally {
      restore();
    }
  }, 25000);

  it('lets no lamp, speech or training follow a check that was left behind', async () => {
    // Leaving the page while the clear is pending: the answer that was waiting
    // must not act afterwards.  The eight-second timer is the board's and is
    // untouched — what must not happen is a *command* from a page nobody is on.
    vi.mocked(api.wasteTeach).mockClear();
    let releaseClear!: (value: { cleared: boolean; confirmed: boolean }) => void;
    const clearDeferred = new Promise<{ cleared: boolean; confirmed: boolean }>((resolve) => {
      releaseClear = resolve;
    });
    const restore = await press({
      predictions: plasticAt(0.95),
      object: 'clear plastic bottle',
      clearDeferred,
    });
    await waitFor(
      () => expect(screen.getByTestId('waste-action')).toHaveTextContent(/plastic bin/i),
      { timeout: 8000 },
    );
    // The decision is already on screen (and its teaching crop already filed —
    // that happened before anyone left).  What must not happen is anything NEW
    // once the page is gone and the clear finally answers.
    expect(api.postRecognition).not.toHaveBeenCalled();
    const spokeBefore = spoken.length;
    const taughtBefore = vi.mocked(api.wasteTeach).mock.calls.length;
    cleanup(); // navigate away: unmount, which must invalidate the check
    restore();

    await act(async () => {
      releaseClear({ cleared: true, confirmed: true });
    });
    await act(async () => undefined);

    expect(api.postRecognition).not.toHaveBeenCalled();
    expect(vi.mocked(api.wasteTeach).mock.calls.length).toBe(taughtBefore);
    expect(spoken.length).toBe(spokeBefore);
  }, 25000);

  it('drops a name that arrives after the page has been left', async () => {
    vi.mocked(api.wasteTeach).mockClear();
    let releaseName!: (value: unknown) => void;
    const restore = await press({
      predictions: plasticAt(0.95),
      identify: () =>
        new Promise((resolve) => {
          releaseName = resolve;
        }) as never,
    });
    const spokeBefore = spoken.length;
    cleanup(); // navigate away before the name answers
    restore();

    await act(async () => {
      releaseName({
        object: 'orange pencil',
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.2-11b-vision-instruct',
        ms: 9000,
      });
    });
    await act(async () => undefined);

    expect(api.postRecognition).not.toHaveBeenCalled();
    expect(api.wasteTeach).not.toHaveBeenCalled();
    expect(spoken.length).toBe(spokeBefore);
  }, 25000);

  it('clears a correction message when the next item is checked', async () => {
    // The operator's correction confirmation belongs to the item it was made
    // about; left on screen it hid the next item's buttons.
    window.history.pushState({}, '', '/waste?operator=1');
    vi.mocked(api.wasteCorrect).mockResolvedValue({ file: 'Plastic/booth-1.jpg', actual: 'paper', saved_as: 'Paper/x.jpg' });
    const first = await press({ predictions: plasticAt(0.95), object: 'clear plastic bottle' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      fireEvent.click(await screen.findByTestId('correct-paper'));
      await waitFor(
        () => expect(screen.getByTestId('waste-correction')).toHaveTextContent(/thank/i),
        { timeout: 4000 },
      );
    } finally {
      first();
    }

    const second = await press({ predictions: plasticAt(0.95), object: 'clear plastic bottle' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      // The buttons are back for this item.
      expect(await screen.findByTestId('correct-paper')).toBeInTheDocument();
      expect(screen.getByTestId('waste-correction')).not.toHaveTextContent(/thank|saved|recorded|noted/i);
    } finally {
      second();
    }
  }, 30000);

  it('treats "nothing visible" as nothing to sort, not as a classifier guess', async () => {
    // An empty base is an answer.  The classifier would happily call the
    // patterned sheet Plastic 0.95, and that must not light a bin.
    vi.mocked(api.wasteTeach).mockClear();
    const restore = await press({
      predictions: plasticAt(0.95),
      identify: (async () => ({
        object: null,
        empty: true,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.2-11b-vision-instruct',
        ms: 800,
      })) as never,
    });
    try {
      await screen.findByTestId('waste-empty', {}, { timeout: 8000 });
      expect(screen.getByTestId('waste-empty')).toHaveTextContent(/nothing to sort/i);
      // No bin question, no lamp, no record, and no training photo.
      expect(api.postRecognition).not.toHaveBeenCalled();
      expect(api.wasteTeach).not.toHaveBeenCalled();
      expect(screen.queryByTestId('waste-action')).not.toBeInTheDocument();
    } finally {
      restore();
    }
  }, 25000);

  it('says the button and a known item name in the chosen language', async () => {
    // Reported 2026-11-20: the button stayed English, and so did the name.
    window.localStorage.setItem('village.voiceLanguage', 'hi');
    const restore = await press({ predictions: plasticAt(0.42), object: 'Onion' });
    try {
      expect(screen.getByTestId('classify-now')).toHaveTextContent('चीज़ जाँचें');
      await waitFor(
        () => expect(screen.getByTestId('waste-sees')).toHaveTextContent('प्याज़'),
        { timeout: 8000 },
      );
    } finally {
      restore();
    }
  }, 25000);

  it('asks in the press language and shows the translated name the backend returns', async () => {
    window.localStorage.setItem('village.voiceLanguage', 'hi');
    const restore = await press({
      predictions: plasticAt(0.42),
      object: 'onion',
      identify: (async (_image: string, language: string) => ({
        object: 'onion',
        object_local: language === 'hi' ? 'कांदा' : null,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.2-11b-vision-instruct',
        ms: 700,
      })) as never,
    });
    try {
      await waitFor(
        () => expect(screen.getByTestId('waste-sees')).toHaveTextContent('कांदा'),
        { timeout: 8000 },
      );
      // The language travels with the request, so the translator is asked for
      // the page's language rather than English.
      expect(api.wasteIdentify).toHaveBeenCalledWith(expect.stringMatching(/^data:image/), 'hi');
    } finally {
      restore();
    }
  }, 25000);

  it('leaves the name out rather than printing English on a Malayalam page', async () => {
    window.localStorage.setItem('village.voiceLanguage', 'ml');
    const restore = await press({
      predictions: plasticAt(0.42),
      object: 'Large yellowish widget',
    });
    try {
      expect(screen.getByTestId('classify-now')).toHaveTextContent('വസ്തു പരിശോധിക്കുക');
      // The category and the action are translated; the untranslatable English
      // noun is left out instead of being shown to a Malayalam reader.
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      expect(screen.queryByTestId('waste-identify')).not.toBeInTheDocument();
      expect(screen.getByTestId('waste-classify')).toHaveTextContent(/പ്ലാസ്റ്റിക്|plastic/i);
    } finally {
      restore();
    }
  }, 25000);
});

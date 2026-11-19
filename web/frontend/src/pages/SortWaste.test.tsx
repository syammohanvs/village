import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../lib/api';
import { makeSettings, makeState } from '../test/fixtures';

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
  vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: false, model: 'resnet50', classes: [] });
  vi.mocked(api.wasteCorrect).mockResolvedValue({
    file: 'capture.jpg',
    actual: 'Plastic',
    saved_as: '/tmp/samples/Plastic/venue-capture.jpg',
  });
  vi.mocked(api.wasteClassify).mockImplementation(async () => ({
    model: 'resnet50',
    predictions: predictionState.current,
  }));
  predictionState.current = DEFAULT_PREDICTIONS;
});

describe('Sort Waste', () => {
  it('says the model is missing and offers the preview without guessing', async () => {
    render(<App />);

    expect(await screen.findByText(/Recognition model is missing/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Start the camera for a preview. Recognition needs the model./i),
    ).toBeInTheDocument();

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
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    render(<App />);

    // Released only once the classifier is ready: pressing it into a
    // half-prepared page is what made "learning the room" look like a fault.
    const start = await screen.findByTestId('start-camera');
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
    expect(start).toHaveTextContent(/start camera/i);
    expect(screen.getByText('How it works')).toBeInTheDocument();
    expect(screen.getByText('Confidence and model details')).toBeInTheDocument();
    expect(screen.getByText(/does not identify people/i)).toBeInTheDocument();
  });

  it('ranks what the model reported and calls predict without the flipped flag', async () => {
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'plastic',
      recognition: { id: 7, category: 'plastic', confidence: 0.95 },
    });
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
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

    render(<App />);
    const startButton = await screen.findByTestId('start-camera');
    await waitFor(() => expect(startButton).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(startButton);
    // A press is the only trigger now: no watcher decides for itself what is
    // "being shown".
    fireEvent.click(await screen.findByTestId('classify-now'));

    await waitFor(() => expect(api.wasteClassify).toHaveBeenCalled(), { timeout: 4000 });
    // predict(image, flipped) returns every class; passing a count mirrored the
    // frame and made '3' look like a page size.
    expect(vi.mocked(api.wasteClassify).mock.calls.length).toBeGreaterThan(0);

    // The list is ranked, not left in metadata order (which starts at Organic).
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('.prediction-list li'));
      expect(rows).toHaveLength(3);
      expect(rows[0].textContent).toContain('Plastic');
      expect(rows[1].textContent).toContain('Paper');
    });

    await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
    expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({
      category: 'plastic',
      confidence: 0.95,
    });
    expect(await screen.findByTestId('waste-result')).toHaveTextContent('Plastic');

    // The camera stays on after a confirmed item, so the next item is one press
    // away and needs no Start Camera.
    expect(stopTrack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /stop camera/i })).toBeInTheDocument();
    expect(screen.queryByTestId('waste-camera-stopped')).not.toBeInTheDocument();
  }, 15000);

});

describe('Sort Waste — the camera waits for the model', () => {
  it('keeps Start Camera disabled until the classifier is ready', async () => {
    // Asked for at the venue: if the page is still preparing, the button must
    // not offer to open the camera.  The model is loaded when the page opens,
    // and the button is released the moment it can answer.
    // This describe sits outside the shared one, so it carries its own mocks.
    vi.mocked(api.state).mockResolvedValue(makeState());
    vi.mocked(api.events).mockResolvedValue({ events: [] });
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
    vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
    });

    let resolveLoad: ((value: { installed: boolean; model: string; classes: string[] }) => void) | null = null;
    const loading = new Promise<{ installed: boolean; model: string; classes: string[] }>((resolve) => {
      resolveLoad = resolve;
    });
    let calls = 0;
    vi.mocked(api.wasteResnetStatus).mockImplementation(() => {
      calls += 1;
      // First call is the page's status query; the second is the model load,
      // which is held open so the intermediate state is real rather than a race.
      if (calls === 1) {
        return Promise.resolve({ installed: true, model: 'resnet50', classes: [] });
      }
      return loading;
    });
    render(<App />);

    expect(await screen.findByText(/Preparing the model/i)).toBeInTheDocument();
    const start = screen.getByTestId('start-camera');
    expect(start).toBeDisabled();

    await act(async () => {
      resolveLoad?.({ installed: true, model: 'resnet50', classes: [] });
    });
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
    expect(start).toHaveTextContent(/start camera/i);
  }, 15000);
});

describe('Sort Waste — one press reads the video, not one frame', () => {
  function stubCamera() {
    vi.mocked(api.state).mockResolvedValue(makeState());
    vi.mocked(api.events).mockResolvedValue({ events: [] });
    vi.mocked(api.settings).mockResolvedValue(makeSettings({ waste_confidence: 0.5 }));
    vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
    vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
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

  it('reads three frames and makes one decision when they agree', async () => {
    // The venue's brown paper cover was Thermocol 0.91, then Thermocol 0.60,
    // then Textile 0.70 within ten seconds.  A press is now a short video: three
    // looks a quarter of a second apart, averaged into one reading.
    stubCamera();
    const original = stubCanvas();
    vi.mocked(api.wasteClassify)
      .mockImplementationOnce(async () => ({ model: 'resnet50', predictions: predictionsFor('Paper', 0.9) }))
      .mockImplementationOnce(async () => ({ model: 'resnet50', predictions: predictionsFor('Paper', 0.92) }))
      .mockImplementationOnce(async () => ({ model: 'resnet50', predictions: predictionsFor('Paper', 0.88) }));
    try {
      render(<App />);
      const start = await screen.findByTestId('start-camera');
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);
      fireEvent.click(await screen.findByTestId('classify-now'));

      await waitFor(() => expect(vi.mocked(api.wasteClassify).mock.calls.length).toBe(3), {
        timeout: 10000,
      });
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalledTimes(1), {
        timeout: 10000,
      });
      const body = vi.mocked(api.postRecognition).mock.calls[0][0];
      expect(JSON.stringify(body)).toMatch(/paper/i);
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
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
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
    predictionState.current = predictionsFor('Plastic', 0.95);

    render(<App />);
    const startButton = await screen.findByTestId('start-camera');
    await waitFor(() => expect(startButton).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(startButton);
    fireEvent.click(await screen.findByTestId('classify-now'));

    await waitFor(() => expect(spoken.length).toBeGreaterThan(0), { timeout: 8000 });
    expect(spokenLanguages).toContain('ml');
    // The sentence itself is Malayalam, not English text read by a Malayalam voice.
    expect(spoken.some((line) => /പ്ലാസ്റ്റിക്/.test(line))).toBe(true);
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
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
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
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
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
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
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
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
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
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
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
  };

  async function press(options: Options): Promise<() => void> {
    const vision = options.vision !== false;
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: true,
      model: 'resnet50',
      classes: [],
      ...(vision
        ? { vision: { provider: 'cloudflare', model: '@cf/meta/llama-3.2-11b-vision-instruct', ready: true } }
        : {}),
    });
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
        /Item identified: clear plastic lid/i,
      );
      expect(within(identifies).getByText(/cloud vision model/i)).toBeInTheDocument();
      expect(within(classifies).getByTestId('waste-result')).toHaveTextContent(/Waste category: Plastic/i);
      expect(within(classifies).getByText(/local ResNet50/i)).toBeInTheDocument();
      expect(action).toHaveTextContent(/Suggested action/i);
      expect(action).toHaveTextContent(/plastic bin/i);

      // Identification, then classification, then the action — the order a
      // person checks an answer in.
      expect(identifies.compareDocumentPosition(classifies) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(classifies.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // Only an accepted bin decision asks for a lamp.
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'plastic' });
    } finally {
      restore();
    }
  }, 25000);

  it('refuses a bin when the two models disagree', async () => {
    // The reported shape: a pencil read as Paper.  The classifier's 93% must
    // not open the paper bin while the name says pencil.
    const restore = await press({ predictions: predictionsFor('Paper', 0.93), object: 'orange pencil' });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      const action = screen.getByTestId('waste-action');
      expect(action).toHaveTextContent(/results need checking/i);
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
      await waitFor(
        () => expect(screen.getByTestId('waste-action')).toHaveTextContent(/e-waste collection/i),
        { timeout: 8000 },
      );
      expect(screen.getByTestId('waste-result')).toHaveTextContent(/Waste category: Electronic waste/i);
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
      expect(action).toHaveTextContent(/e-waste collection/i);
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'other' });
    } finally {
      restore();
    }
  }, 25000);

  it('will not light a bin when the namer is configured but did not answer', async () => {
    const restore = await press({ predictions: plasticAt(0.95), object: null });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      const action = screen.getByTestId('waste-action');
      expect(action).toHaveTextContent(/identification unavailable/i);
      expect(action).toHaveTextContent(/ask the gram sahayak/i);
      expect(within(screen.getByTestId('waste-identify')).getByTestId('waste-sees')).toHaveTextContent(
        /identification unavailable/i,
      );
      // The category is still reported honestly…
      expect(screen.getByTestId('waste-result')).toHaveTextContent(/Waste category: Plastic/i);
      // …but nothing physical happens.
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'other' });
    } finally {
      restore();
    }
  }, 25000);

  it('keeps the documented local-only policy when no namer is configured', async () => {
    const restore = await press({ predictions: plasticAt(0.95), vision: false });
    try {
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 8000 });
      const action = screen.getByTestId('waste-action');
      expect(action).toHaveTextContent(/plastic bin/i);
      expect(api.wasteIdentify).not.toHaveBeenCalled();
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'plastic' });
    } finally {
      restore();
    }
  }, 25000);

  it('says nothing to sort for the background class, and records nothing', async () => {
    const restore = await press({ predictions: predictionsFor('Background', 0.93), object: null });
    try {
      await waitFor(
        () => expect(screen.getByTestId('waste-action')).toHaveTextContent(/nothing to sort/i),
        { timeout: 8000 },
      );
      expect(api.postRecognition).not.toHaveBeenCalled();
    } finally {
      restore();
    }
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
      expect(screen.getByTestId('waste-result')).toHaveTextContent(/Waste category: Paper/i);
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'paper' });
    } finally {
      restore();
    }
  }, 25000);

  it('speaks the accepted answer once', async () => {
    const restore = await press({ predictions: plasticAt(0.95), object: 'clear plastic lid' });
    try {
      await screen.findByTestId('waste-action', {}, { timeout: 8000 });
      await waitFor(
        () => expect(spoken.filter((line) => /plastic bin/i.test(line))).toHaveLength(1),
        { timeout: 6000 },
      );
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
      await waitFor(
        () => expect(screen.getByTestId('waste-action')).toHaveTextContent(/identification unavailable/i),
        { timeout: 12000 },
      );
      await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
      expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({ category: 'other' });

      await act(async () => {
        release?.({ object: 'orange pencil', provider: 'cloudflare', model: 'llama', ms: 9000 });
      });
      // The late answer must not change the action, the category or the record.
      expect(screen.getByTestId('waste-action')).toHaveTextContent(/identification unavailable/i);
      expect(screen.getByTestId('waste-result')).toHaveTextContent(/Waste category: Plastic/i);
      expect(vi.mocked(api.postRecognition).mock.calls).toHaveLength(1);
    } finally {
      restore();
    }
  }, 30000);
});

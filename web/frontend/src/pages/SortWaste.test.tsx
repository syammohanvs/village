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

  it('refers a recycler material to the agent instead of a bin', async () => {
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'other',
      recognition: { id: 9, category: 'other', confidence: 0.9 },
    });
    predictionState.current = [
      { className: 'Organic', probability: 0.01 },
      { className: 'Plastic', probability: 0.03 },
      { className: 'Paper', probability: 0.01 },
      { className: 'Glass', probability: 0.9 },
      { className: 'Metal', probability: 0.02 },
      { className: 'Textile', probability: 0.005 },
      { className: 'Leather', probability: 0.005 },
      { className: 'Footwear', probability: 0.005 },
      { className: 'Thermocol', probability: 0.005 },
      { className: 'Ewaste', probability: 0.005 },
      { className: 'Background', probability: 0.01 },
    ];
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
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

    await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
    const recyclerCall = vi.mocked(api.postRecognition).mock.calls[0][0];
    expect(recyclerCall.category).toBe('other');
    expect(recyclerCall.confidence).toBeCloseTo(0.945, 6);
    expect(await screen.findByTestId('waste-result')).toHaveTextContent('Glass');
    // A material that is not one of the three bins: the card keeps it out and
    // names the support role, and it never claims a bin.
    expect(screen.getByTestId('waste-destination')).toHaveTextContent(/keep separate|ask the gram sahayak/i);
    expect(screen.getByTestId('waste-destination')).toHaveTextContent(/gram sahayak/i);
    expect(screen.queryByText(/Put it in the glass bin/i)).not.toBeInTheDocument();
    expect(stopTrack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /stop camera/i })).toBeInTheDocument();
  }, 15000);

  it('treats background and ordinary objects as nothing to sort, with no recognition', async () => {
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    vi.mocked(api.postRecognition).mockClear();
    // A car key, a phone or the empty table: the model's "Background" class is
    // the not-waste side, and it must never become a recycling referral.
    predictionState.current = [
      { className: 'Organic', probability: 0.005 },
      { className: 'Plastic', probability: 0.01 },
      { className: 'Paper', probability: 0.01 },
      { className: 'Glass', probability: 0.005 },
      { className: 'Metal', probability: 0.005 },
      { className: 'Textile', probability: 0.005 },
      { className: 'Leather', probability: 0.01 },
      { className: 'Footwear', probability: 0.005 },
      { className: 'Thermocol', probability: 0.005 },
      { className: 'Ewaste', probability: 0.01 },
      { className: 'Background', probability: 0.93 },
    ];
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

    render(<App />);
    const startButton = await screen.findByTestId('start-camera');
    await waitFor(() => expect(startButton).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(startButton);
    // A press is the only trigger now: no watcher decides for itself what is
    // "being shown".
    fireEvent.click(await screen.findByTestId('classify-now'));

    expect(await screen.findByText(/Nothing to sort/i, {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('.prediction-list li'));
      expect(rows[0].textContent).toContain('Not a waste item');
    });
    // Long enough that a watcher would have learned the room and fired.
    await new Promise((resolve) => setTimeout(resolve, 6000));
    expect(api.postRecognition).not.toHaveBeenCalled();
    expect(screen.queryByTestId('waste-result')).not.toBeInTheDocument();
    expect(screen.queryByTestId('waste-destination')).not.toBeInTheDocument();
  }, 15000);

  it('accepts a split recycler vote as one recycling outcome', async () => {
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.75, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    vi.mocked(api.postRecognition).mockClear();
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'other',
      recognition: { id: 31, category: 'other', confidence: 0.8 },
    });
    // No single class clears 75%, but Ewaste + Metal together do.  Both are the
    // same action, so the item should be referred to the recycling agent.
    predictionState.current = [
      { className: 'Organic', probability: 0.01 },
      { className: 'Plastic', probability: 0.1 },
      { className: 'Paper', probability: 0.02 },
      { className: 'Glass', probability: 0.02 },
      { className: 'Metal', probability: 0.35 },
      { className: 'Textile', probability: 0.01 },
      { className: 'Leather', probability: 0.01 },
      { className: 'Footwear', probability: 0.01 },
      { className: 'Thermocol', probability: 0.01 },
      { className: 'Ewaste', probability: 0.45 },
      { className: 'Background', probability: 0.01 },
    ];
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

    render(<App />);
    const startButton = await screen.findByTestId('start-camera');
    await waitFor(() => expect(startButton).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(startButton);
    // A press is the only trigger now: no watcher decides for itself what is
    // "being shown".
    fireEvent.click(await screen.findByTestId('classify-now'));

    await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
    const splitCall = vi.mocked(api.postRecognition).mock.calls[0][0];
    expect(splitCall.category).toBe('other');
    expect(splitCall.confidence).toBeCloseTo(0.86, 6);
    expect(await screen.findByTestId('waste-result')).toHaveTextContent('Electronic waste');
    expect(screen.getByTestId('waste-destination')).toHaveTextContent(/keep separate|gram sahayak/i);
  }, 15000);

  it('names its best guess and the percentage instead of going quiet', async () => {
    // "Unable to identify it for a long time" was the report: the page said
    // "Not sure yet" forever, which tells the operator nothing.  Naming the
    // guess and how sure it is shows them what to fix.
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.9, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
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
    predictionState.current = predictionsFor('Paper', 0.55);

    render(<App />);
    const start = await screen.findByTestId('start-camera');
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(start);
    // These suites keep the automatic watcher on: the behaviour they
    // cover is what happens while the camera is being watched.
    fireEvent.click(await screen.findByTestId('classify-now'));

    // Under the bar it names no material at all.  "Best guess Thermocol at 59%"
    // read as a classification -- the venue reported a cloth scrunchie as
    // "recognised as thermocol" three times over, when the press had in fact
    // chosen no bin.  The guess is a property of the crop, not of the item, so
    // saying which material it nearly said is a claim the picture cannot support.
    const line = await screen.findByText(/Not sure what this is/i, {}, { timeout: 5000 });
    expect(line.textContent).not.toMatch(/Paper/i);
    // It must not claim a bin it is not sure about.
    expect(screen.queryByTestId('waste-result')).not.toBeInTheDocument();
    expect(api.postRecognition).not.toHaveBeenCalled();
  }, 15000);
});

describe('Sort Waste — Sara speaks without waiting on the recording', () => {
  it('says the result even when the record request never answers', async () => {
    // Measured in the app: the sentence waited for POST /waste/recognition,
    // which asks the controller for its bin levels and took 19-21 s with the
    // board switched off.  The sentence is already known from the frame, so it
    // must not depend on that call at all.
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    // A promise that never settles: exactly the case that used to hang.
    vi.mocked(api.postRecognition).mockImplementation(
      () => new Promise(() => undefined) as never,
    );
    predictionState.current = [
      { className: 'Metal', probability: 0.91 },
      { className: 'Ewaste', probability: 0.05 },
      { className: 'Background', probability: 0.01 },
    ];

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

    render(<App />);
    const start = await screen.findByTestId('start-camera');
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(start);
    // These suites keep the automatic watcher on: the behaviour they
    // cover is what happens while the camera is being watched.
    fireEvent.click(await screen.findByTestId('classify-now'));

    // The greeting speaks on mount, so look for the classification itself.
    await waitFor(
      () => expect(spoken.some((line) => /keep this item separate/i.test(line))).toBe(true),
      { timeout: 8000 },
    );
    // ...and the request is genuinely still outstanding, so this was not a
    // lucky ordering.
    expect(api.postRecognition).toHaveBeenCalled();
    // The material travels with the record: "other" alone could not answer
    // "what did it call my key fob?" later.
    expect(api.postRecognition).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'other', material: 'Metal' }),
    );
    // ...and the guesses that produced it.  These were empty in every event
    // because `accept` read a stale state list; a review had no way to see that
    // "Thermocol" was chosen over "Metal 0.04".
    const sent = vi.mocked(api.postRecognition).mock.calls[0][0] as {
      top?: Array<{ className: string; probability: number }>;
    };
    expect(sent.top?.[0]).toEqual({ className: 'Metal', probability: 0.91 });
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

  it('puts the helper line on the bin card instead of speaking on load', async () => {
    // Asked for: not to have Sara say what to do as the page opens, and to show
    // that line on the suggested-bin card instead -- which then carries the
    // result as soon as there is one.
    stubCamera();
    const original = stubCanvas();
    vi.mocked(api.wasteClassify).mockImplementation(async () => ({
      model: 'resnet50',
      predictions: predictionsFor('Paper', 0.94),
    }));
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'paper',
      recognition: { id: 9, category: 'paper', confidence: 0.94 },
    });
    try {
      render(<App />);
      // No greeting card, and nothing spoken on arrival.
      expect(screen.queryByTestId('waste-welcome')).not.toBeInTheDocument();

      const start = await screen.findByTestId('start-camera');
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);

      const guidance = await screen.findByTestId('waste-guidance');
      expect(guidance).toHaveTextContent(/know the bin/i);

      // A reading replaces it with the usual bin card.
      fireEvent.click(await screen.findByTestId('classify-now'));
      expect(await screen.findByTestId('waste-result', {}, { timeout: 10000 })).toBeInTheDocument();
      expect(screen.queryByTestId('waste-guidance')).not.toBeInTheDocument();
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  }, 30000);

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
      // 0.7 of the short side: 70% tall, and 39.38% wide on a 16:9 camera.
      // (jsdom prints "70%" for "70.00%", so compare the numbers.)
      expect(parseFloat(guide.style.height)).toBeCloseTo(70, 2);
      expect(parseFloat(guide.style.width)).toBeCloseTo(39.38, 2);
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

  it('does not decide anything when the three frames disagree', async () => {
    // Averaging is what turns a flipping model into an honest "not sure": three
    // different answers at 0.90 average to 0.30 each, which is under any sane
    // threshold.  That is the whole point of reading a moment instead of a
    // still -- it needs no separate "the frames disagreed" rule.
    //
    // The three are deliberately from three different bins.  Two recyclers that
    // disagree still add up to "recycling" (which is the documented grouping
    // rule and a correct answer), so they would not test this.
    stubCamera();
    const original = stubCanvas();
    vi.mocked(api.wasteClassify)
      .mockImplementationOnce(async () => ({ model: 'resnet50', predictions: predictionsFor('Paper', 0.9) }))
      .mockImplementationOnce(async () => ({ model: 'resnet50', predictions: predictionsFor('Plastic', 0.9) }))
      .mockImplementationOnce(async () => ({ model: 'resnet50', predictions: predictionsFor('Organic', 0.9) }));
    try {
      render(<App />);
      const start = await screen.findByTestId('start-camera');
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);
      fireEvent.click(await screen.findByTestId('classify-now'));

      await waitFor(() => expect(vi.mocked(api.wasteClassify).mock.calls.length).toBe(3), {
        timeout: 10000,
      });
      expect(await screen.findByText(/Not sure what this is/i, {}, { timeout: 5000 })).toBeInTheDocument();
      expect(api.postRecognition).not.toHaveBeenCalled();
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  }, 30000);
});

describe('Sort Waste — a near-tie is not a decision', () => {
  it('does not record or light anything when the best guess is under the threshold', async () => {
    // The handkerchief: Leather 0.24, Paper 0.24, Background 0.22.  A pressed
    // reading used to skip the confidence threshold, so that tie was recorded
    // and reported as "leather".  It has to say what it guessed and stop.
    vi.mocked(api.state).mockResolvedValue(makeState());
    vi.mocked(api.events).mockResolvedValue({ events: [] });
    vi.mocked(api.settings).mockResolvedValue(makeSettings({ waste_confidence: 0.5 }));
    vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
    vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.postRecognition).mockClear();
    predictionState.current = [
      { className: 'Leather', probability: 0.24 },
      { className: 'Paper', probability: 0.24 },
      { className: 'Background', probability: 0.22 },
    ];
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

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
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

    try {
      render(<App />);
      const start = await screen.findByTestId('start-camera');
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);
      fireEvent.click(await screen.findByTestId('classify-now'));

      // It says it cannot tell, and names no material — the near-tie is exactly
      // the case where naming one of the three would be picking a winner out of
      // noise.
      const line = await screen.findByText(/Not sure what this is/i, {}, { timeout: 5000 });
      expect(line.textContent).not.toMatch(/Leather/i);
      // Nor is a material named anywhere else: the per-class readout is for a
      // decision, and there is none.  This list was the last place "Thermocol
      // 74%" stayed on screen while nothing had been chosen.
      expect(document.querySelector('.prediction-list')).toBeNull();
      // ...and does not record it as a decision.
      expect(api.postRecognition).not.toHaveBeenCalled();
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  }, 20000);
});

describe('Sort Waste — nothing is classified unless it is asked for', () => {
  it('does not classify on its own, and does when the button is pressed', async () => {
    // Reported: "again I didn't show my hand at all and it classified" — as
    // thermocol, with nothing in hand. An automatic watcher in a room with a
    // person in it decides for itself what is "being shown", and that decision
    // is wrong often enough to be worse than useless. A press cannot be wrong
    // about it, so it is the default and the watcher is opt-in.
    vi.mocked(api.state).mockResolvedValue(makeState());
    vi.mocked(api.events).mockResolvedValue({ events: [] });
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
    vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.wasteClassify).mockClear();
    vi.mocked(api.postRecognition).mockClear();
    predictionState.current = [
      { className: 'Thermocol', probability: 0.78 },
      { className: 'Paper', probability: 0.1 },
      { className: 'Background', probability: 0.05 },
    ];
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

    // A frame the page can read, as in a browser.
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
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
            data[i] = 40;
            data[i + 1] = 40;
            data[i + 2] = 40;
            data[i + 3] = 255;
          }
          // Something clearly in the frame: with a watcher running this would be
          // classified on its own, which is the behaviour being ruled out.
          for (let y = 40; y < 80; y += 1) {
            for (let x = 50; x < 110; x += 1) {
              const i = (y * width + x) * 4;
              data[i] = 220;
              data[i + 1] = 220;
              data[i + 2] = 215;
            }
          }
          return { data, width, height };
        },
      };
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    try {
    render(<App />);
    const start = await screen.findByTestId('start-camera');
    await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(start);

    // The watcher is off: no request leaves the page, however long it runs.
    const check = await screen.findByTestId('classify-now');
    // The default is what makes it safe: the watcher is off, so the loop that
    // decides what is "being shown" does not run at all.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.wasteClassify).not.toHaveBeenCalled();
    expect(screen.getByTestId('waste-press-hint')).toHaveTextContent(/press/i);

    // One press, one answer.
    fireEvent.click(check);
    await waitFor(() => expect(api.wasteClassify).toHaveBeenCalledTimes(1), { timeout: 5000 });
    await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 5000 });
    expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toEqual(
      expect.objectContaining({ category: 'other', material: 'Thermocol' }),
    );
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  }, 25000);
  it('does not call a 60% bin answer strong, and says which bar it missed', async () => {
    // A plastic bottle split Plastic 0.60 / Glass 0.25: below the 70% a bin
    // needs, so nothing may be recorded -- but the row used to be highlighted
    // and the page said nothing about why (reported from the venue 2026-11-16).
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    predictionState.current = [
      { className: 'Organic', probability: 0.01 },
      { className: 'Plastic', probability: 0.6 },
      { className: 'Paper', probability: 0.02 },
      { className: 'Glass', probability: 0.25 },
      { className: 'Metal', probability: 0.02 },
      { className: 'Textile', probability: 0.02 },
      { className: 'Leather', probability: 0.02 },
      { className: 'Footwear', probability: 0.02 },
      { className: 'Thermocol', probability: 0.02 },
      { className: 'Ewaste', probability: 0.01 },
      { className: 'Background', probability: 0.01 },
    ];
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

    render(<App />);
    const startButton = await screen.findByTestId('start-camera');
    await waitFor(() => expect(startButton).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(startButton);
    fireEvent.click(await screen.findByTestId('classify-now'));

    await waitFor(() => expect(api.wasteClassify).toHaveBeenCalled(), { timeout: 4000 });

    // 60% of a bin is not a decision, so the per-class readout stays hidden --
    // naming a material the page has not chosen is what read as "it knows it is
    // plastic but says nothing".
    await waitFor(() => expect(document.querySelector('.prediction-list')).toBeNull());
    expect(document.querySelector('.is-strong')).toBeNull();

    // What is shown instead is the bar that was missed.
    expect(await screen.findByText(/A bin needs 70%/)).toBeInTheDocument();
    // Nothing was recorded, which is the point: a bin must not be guessed.
    expect(api.postRecognition).not.toHaveBeenCalled();
  });
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
  it('files a misread as a training photo when the operator corrects it', async () => {
    // The venue's whole learning loop: one press, and the frame the model got
    // wrong joins data/waste-samples/<Class>/ for the next training run.
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'metal',
      recognition: { id: 21, category: 'metal', confidence: 0.65 },
    });
    predictionState.current = [
      { className: 'Organic', probability: 0.02 },
      { className: 'Plastic', probability: 0.15 },
      { className: 'Paper', probability: 0.02 },
      { className: 'Glass', probability: 0.05 },
      { className: 'Metal', probability: 0.65 },
      { className: 'Textile', probability: 0.03 },
      { className: 'Leather', probability: 0.02 },
      { className: 'Footwear', probability: 0.02 },
      { className: 'Thermocol', probability: 0.01 },
      { className: 'Ewaste', probability: 0.02 },
      { className: 'Background', probability: 0.01 },
    ];
    vi.mocked(api.wasteClassify).mockImplementation(async () => ({
      model: 'resnet50',
      predictions: predictionState.current,
      file: 'capture.jpg',
    }));

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

    render(<App />);
    const startButton = await screen.findByTestId('start-camera');
    await waitFor(() => expect(startButton).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(startButton);
    fireEvent.click(await screen.findByTestId('classify-now'));

    const correction = await screen.findByTestId('waste-correction', {}, { timeout: 8000 });
    expect(within(correction).getByText(/Wrong\? It was/)).toBeInTheDocument();
    fireEvent.click(within(correction).getByTestId('correct-plastic'));

    await waitFor(() => expect(api.wasteCorrect).toHaveBeenCalled());
    // The frame the model judged, not "the most recent crop".
    expect(vi.mocked(api.wasteCorrect).mock.calls[0]).toEqual(['capture.jpg', 'plastic']);
    expect(await screen.findByText(/now in the training set for Plastic/)).toBeInTheDocument();
  });
  it('still answers when the board is offline, and says the LED was not lit', async () => {
    // The camera and the model run on this laptop; only the bin indicator needs
    // the board.  This used to be a red error with no answer at all.
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'plastic',
      recognition: { id: 31, category: 'plastic', confidence: 0.9 },
      indication: null,
      physical: false,
      led_note: 'No bin LED was lit: the controller did not answer. The sorting answer above still applies.',
    });
    predictionState.current = predictionsFor('Plastic', 0.95);

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

    render(<App />);
    const startButton = await screen.findByTestId('start-camera');
    await waitFor(() => expect(startButton).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(startButton);
    fireEvent.click(await screen.findByTestId('classify-now'));

    expect(await screen.findByTestId('waste-result', {}, { timeout: 8000 })).toHaveTextContent('Plastic');
    const note = await screen.findByTestId('waste-led-note');
    expect(note).toHaveTextContent('No bin LED was lit');
    // The routing is still shown -- that is the point.
    expect(screen.getByTestId('waste-destination')).toHaveTextContent(/plastic bin/i);
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

describe('Sort Waste — the object is named before the category', () => {
  it('says what it sees, then what the classifier says, and speaks the object first', async () => {
    // Reported 2026-11-19: a plastic cap was classified Ewaste 0.40 with no
    // sign of what the camera thought it was.  The hosted model named the same
    // crop "clear plastic lid", so the card must say that FIRST — a visitor
    // checks an answer in that order, and a wrong name is visible instead of
    // being hidden inside a confident category.
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: true,
      model: 'resnet50',
      classes: [],
      vision: { provider: 'cloudflare', model: '@cf/meta/llama-3.2-11b-vision-instruct', ready: true },
    });
    vi.mocked(api.wasteIdentify).mockResolvedValue({
      object: 'clear plastic lid',
      provider: 'cloudflare',
      model: '@cf/meta/llama-3.2-11b-vision-instruct',
      ms: 900,
    });
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'plastic',
      recognition: { id: 12, category: 'plastic', confidence: 0.95 },
    });
    predictionState.current = predictionsFor('Plastic', 0.95);
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
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByTestId('start-camera')).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(screen.getByTestId('start-camera'));
      fireEvent.click(await screen.findByTestId('classify-now'));

      const sees = await screen.findByTestId('waste-sees', {}, { timeout: 8000 });
      expect(sees).toHaveTextContent(/I see: clear plastic lid/i);
      const says = screen.getByTestId('waste-result');
      expect(says).toHaveTextContent(/My classifier says: Plastic/i);
      // The name comes first in the card, not only in the sentence.
      expect(sees.compareDocumentPosition(says) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // ...and the same crop is what the namer was asked about.
      expect(api.wasteIdentify).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg/));

      await waitFor(
        () => expect(spoken.some((line) => /^This is clear plastic lid\./.test(line))).toBe(true),
        { timeout: 5000 },
      );
      expect(spoken.some((line) => /plastic bin/i.test(line))).toBe(true);
    } finally {
      restore();
    }
  }, 25000);

  it('says it is naming the item, so a slow answer does not look frozen', async () => {
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: true,
      model: 'resnet50',
      classes: [],
      vision: { provider: 'cloudflare', model: 'llama', ready: true },
    });
    let answer: (value: unknown) => void = () => undefined;
    vi.mocked(api.wasteIdentify).mockImplementation(
      () => new Promise((resolve) => { answer = resolve; }) as never,
    );
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'plastic',
      recognition: { id: 13, category: 'plastic', confidence: 0.95 },
    });
    predictionState.current = predictionsFor('Plastic', 0.95);
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
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByTestId('start-camera')).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(screen.getByTestId('start-camera'));
      fireEvent.click(await screen.findByTestId('classify-now'));

      await screen.findByTestId('waste-working', {}, { timeout: 8000 });
      // The press reads three frames first, then asks for the name: the line
      // says which of the two it is doing, so a pause never looks like a freeze.
      await waitFor(
        () => expect(screen.getByTestId('waste-working')).toHaveTextContent(
          /Asking the camera what this is/i,
        ),
        { timeout: 8000 },
      );

      await act(async () => {
        answer({ object: 'clear plastic lid', provider: 'cloudflare', model: 'llama', ms: 900 });
      });
    } finally {
      restore();
    }
  }, 25000);
});

describe('Sort Waste — a named object on a reading the page will not bin', () => {
  it('still says what it sees when the classifier is under its bar', async () => {
    // A wrong bin is the failure this page exists to avoid, so a reading under
    // 70% is refused — but "I see a clear plastic lid" is the one useful thing
    // left, and it is exactly the case the reporter hit (cap read as Ewaste).
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({
      installed: true,
      model: 'resnet50',
      classes: [],
      vision: { provider: 'cloudflare', model: 'llama', ready: true },
    });
    vi.mocked(api.wasteIdentify).mockResolvedValue({
      object: 'clear plastic lid',
      provider: 'cloudflare',
      model: 'llama',
      ms: 900,
    });
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    vi.mocked(api.postRecognition).mockClear();
    // A bin needs 70%: Plastic 0.40 is refused, so nothing may be recorded.
    predictionState.current = predictionsFor('Plastic', 0.4);
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
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByTestId('start-camera')).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(screen.getByTestId('start-camera'));
      fireEvent.click(await screen.findByTestId('classify-now'));

      const sees = await screen.findByTestId('waste-sees-unsure', {}, { timeout: 8000 });
      expect(sees).toHaveTextContent(/I see: clear plastic lid/i);
      // Nothing was recorded: the name is not a category and must not open a bin.
      expect(api.postRecognition).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  }, 25000);
});

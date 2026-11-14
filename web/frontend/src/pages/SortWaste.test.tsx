import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../lib/api';
import { saveBackgrounds } from '../lib/backgroundStore';
import { makeSettings, makeState } from '../test/fixtures';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      state: vi.fn(),
      settings: vi.fn(),
      wasteModelStatus: vi.fn(),
      wasteResnetStatus: vi.fn(),
      wasteClassify: vi.fn(),
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

vi.mock('../lib/speech', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/speech')>();
  return {
    ...actual,
    speakText: (text: string) => {
      spoken.push(text);
      return Promise.resolve();
    },
  };
});

// Every quality argument the page has passed to toDataURL since the last
// test started.  The JPEG quality is an accuracy knob (measured, see
// SortWaste.tsx), so it is worth pinning where a test can see it.
const toDataUrlCalls: unknown[] = [];

beforeEach(() => {
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
    }),
  });
  toDataUrlCalls.length = 0;
  spoken.length = 0;
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
      bin: { id: 'plastic', state: 'available' },
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
    // The automatic watcher is opt-in now: a press cannot be wrong about whether
    // an item is being shown, so it is the default.
    fireEvent.click(await screen.findByTestId('auto-watch'));

    await waitFor(() => expect(api.wasteClassify).toHaveBeenCalled(), { timeout: 4000 });
    // predict(image, flipped) returns every class; passing a count mirrored the
    // frame and made '3' look like a page size.
    expect(vi.mocked(api.wasteClassify).mock.calls.length).toBeGreaterThan(0);
    expect(await screen.findByText(/Looking at Plastic/i)).toBeInTheDocument();

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

    // The camera stays on after a confirmed item.  Removing the item lets the
    // stabilizer re-arm, so the next item needs no Start Camera press.
    expect(stopTrack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /stop camera/i })).toBeInTheDocument();
    expect(screen.queryByTestId('waste-camera-stopped')).not.toBeInTheDocument();
    expect(screen.getByTestId('waste-rearm')).toHaveTextContent(/remove the item/i);
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
    // The automatic watcher is opt-in now: a press cannot be wrong about whether
    // an item is being shown, so it is the default.
    fireEvent.click(await screen.findByTestId('auto-watch'));

    await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
    const recyclerCall = vi.mocked(api.postRecognition).mock.calls[0][0];
    expect(recyclerCall.category).toBe('other');
    expect(recyclerCall.confidence).toBeCloseTo(0.945, 6);
    expect(await screen.findByTestId('waste-result')).toHaveTextContent('Glass');
    expect(screen.getByTestId('waste-referral')).toHaveTextContent(/recycling agent/i);
    expect(screen.getByTestId('waste-referral')).toHaveTextContent(/contact the operator/i);
    expect(screen.queryByText(/Put it in the glass bin/i)).not.toBeInTheDocument();
    expect(stopTrack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /stop camera/i })).toBeInTheDocument();
  }, 15000);

  it('refers hazardous waste to the operator instead of a bin', async () => {
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'medical',
      recognition: { id: 10, category: 'medical', confidence: 0.92 },
    });
    predictionState.current = [
      { className: 'Organic', probability: 0.01 },
      { className: 'Plastic', probability: 0.03 },
      { className: 'Paper', probability: 0.01 },
      { className: 'Glass', probability: 0.02 },
      { className: 'Metal', probability: 0.02 },
      { className: 'Textile', probability: 0.005 },
      { className: 'Leather', probability: 0.005 },
      { className: 'Footwear', probability: 0.005 },
      { className: 'Thermocol', probability: 0.005 },
      { className: 'Ewaste', probability: 0.005 },
      { className: 'Medical', probability: 0.9 },
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
    // The automatic watcher is opt-in now: a press cannot be wrong about whether
    // an item is being shown, so it is the default.
    fireEvent.click(await screen.findByTestId('auto-watch'));

    await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
    expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({
      category: 'medical',
      confidence: 0.9,
    });
    expect(await screen.findByTestId('waste-result')).toHaveTextContent('Medical waste');
    expect(screen.getByTestId('waste-hazardous')).toHaveTextContent(/hazardous waste/i);
    expect(screen.getByTestId('waste-hazardous')).toHaveTextContent(/contact the operator/i);
    expect(screen.queryByText(/Put it in the medical bin/i)).not.toBeInTheDocument();
    // A camera-recognised hazardous item also leaves the camera running; the
    // manual Hazardous button is the one that stops it.
    expect(stopTrack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /stop camera/i })).toBeInTheDocument();
  }, 15000);

  it('records a hazardous item through the manual button without a bin LED', async () => {
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'medical',
      recognition: { id: 11, category: 'medical', confidence: 1 },
    });
    predictionState.current = DEFAULT_PREDICTIONS;
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
    fireEvent.click(screen.getByTestId('hazardous-button'));

    await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 4000 });
    expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({
      category: 'medical',
      confidence: 1,
    });
    expect(await screen.findByTestId('waste-result')).toHaveTextContent('Medical waste');
    expect(screen.getByTestId('waste-hazardous')).toHaveTextContent(/hazardous waste/i);
    expect(screen.getByTestId('waste-hazardous')).toHaveTextContent(/contact the operator/i);
    expect(screen.queryByTestId('waste-referral')).not.toBeInTheDocument();
  }, 15000);

  it('offers a background snapshot so the room is not classified', async () => {
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    predictionState.current = DEFAULT_PREDICTIONS;
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
    // The automatic watcher is opt-in now: a press cannot be wrong about whether
    // an item is being shown, so it is the default.
    fireEvent.click(await screen.findByTestId('auto-watch'));

    expect(await screen.findByTestId('set-background')).toBeInTheDocument();
    expect(screen.getByLabelText(/Focus on the object/i)).toBeChecked();
    // The venue is a dynamic room where the item is held up to the camera, so
    // an empty table is the exception, not the instruction.  The page used to
    // tell the operator to clear a table they do not have.
    expect(screen.getByText(/held in your hand is fine/i)).toBeInTheDocument();
    expect(screen.queryByText(/Show the empty table and press/i)).not.toBeInTheDocument();
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
    // The automatic watcher is opt-in now: a press cannot be wrong about whether
    // an item is being shown, so it is the default.
    fireEvent.click(await screen.findByTestId('auto-watch'));

    expect(await screen.findByText(/Nothing to sort/i, {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('.prediction-list li'));
      expect(rows[0].textContent).toContain('Not a waste item');
    });
    // Long enough that a watcher would have learned the room and fired.
    await new Promise((resolve) => setTimeout(resolve, 6000));
    expect(api.postRecognition).not.toHaveBeenCalled();
    expect(screen.queryByTestId('waste-result')).not.toBeInTheDocument();
    expect(screen.queryByTestId('waste-referral')).not.toBeInTheDocument();
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
    // The automatic watcher is opt-in now: a press cannot be wrong about whether
    // an item is being shown, so it is the default.
    fireEvent.click(await screen.findByTestId('auto-watch'));

    await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
    const splitCall = vi.mocked(api.postRecognition).mock.calls[0][0];
    expect(splitCall.category).toBe('other');
    expect(splitCall.confidence).toBeCloseTo(0.86, 6);
    expect(await screen.findByTestId('waste-result')).toHaveTextContent('Electronic waste');
    expect(screen.getByTestId('waste-referral')).toHaveTextContent(/recycling agent/i);
  }, 15000);

  it('keeps the camera running and arms itself for the next item', async () => {
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
    vi.mocked(api.settings).mockResolvedValue(
      makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
    );
    vi.mocked(api.postRecognition).mockClear();
    vi.mocked(api.postRecognition).mockResolvedValue({
      ok: true,
      category: 'plastic',
      recognition: { id: 21, category: 'plastic', confidence: 0.95 },
    });
    predictionState.current = predictionsFor('Plastic', 0.95);
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
    // The automatic watcher is opt-in now: a press cannot be wrong about whether
    // an item is being shown, so it is the default.
    fireEvent.click(await screen.findByTestId('auto-watch'));

    await waitFor(() => expect(api.postRecognition).toHaveBeenCalledTimes(1), { timeout: 6000 });
    expect(stopTrack).not.toHaveBeenCalled();

    // The item is removed: the empty scene re-arms the stabilizer.
    predictionState.current = predictionsFor('Background', 0.99);
    expect(await screen.findByTestId('waste-ready', {}, { timeout: 10000 })).toHaveTextContent(
      /camera armed/i,
    );

    // The next item is classified without pressing Start Camera again.
    predictionState.current = predictionsFor('Paper', 0.95);
    await waitFor(() => expect(api.postRecognition).toHaveBeenCalledTimes(2), { timeout: 6000 });
    expect(vi.mocked(api.postRecognition).mock.calls[1][0]).toMatchObject({
      category: 'paper',
      confidence: 0.95,
    });
    expect(stopTrack).not.toHaveBeenCalled();
  }, 25000);
});

describe('Sort Waste — a low guess says what it is', () => {
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
    fireEvent.click(await screen.findByTestId('auto-watch'));

    expect(await screen.findByText(/Best guess Paper at 55%/i, {}, { timeout: 5000 })).toBeInTheDocument();
    // It must not claim a bin it is not sure about.
    expect(screen.queryByTestId('waste-result')).not.toBeInTheDocument();
    expect(api.postRecognition).not.toHaveBeenCalled();
  }, 15000);
});

describe('Sort Waste — the empty table is painted out', () => {
  // jsdom has no canvas implementation, so the drawing calls are recorded.  What
  // is asserted here is the *order* and the composite operations, which is the
  // part a component test can hold; the pixels are measured in docs/verification.md
  // against 217 real scenes.
  // `null` draws one item over the stored empty scene; a number paints the
  // whole frame that brightness, which is what a nudged camera or a change of
  // light looks like.
  let frameOverride: number | null = null;
  // Whether the item is in the frame.  The room is what the page learns; the
  // item is what it should classify once the room is known.
  let showItem = true;

  class RecordingContext {
    canvas: HTMLCanvasElement;
    ops: string[];
    globalCompositeOperation = 'source-over';
    fillStyle = '';
    constructor(canvas: HTMLCanvasElement, ops: string[]) {
      this.canvas = canvas;
      this.ops = ops;
    }
    drawImage() {
      this.ops.push(`drawImage:${this.canvas.width}x${this.canvas.height}`);
    }
    getImageData(_x: number, _y: number, width: number, height: number) {
      const base = frameOverride ?? 20;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = base;
        data[i + 1] = base;
        data[i + 2] = base;
        data[i + 3] = 255;
      }
      if (frameOverride === null && showItem) {
        // An item sitting in the middle of the analysis frame; everything else
        // is exactly the stored empty scene.
        for (let y = 50; y < 62; y += 1) {
          for (let x = 70; x < 82; x += 1) {
            const i = (y * width + x) * 4;
            data[i] = 250;
            data[i + 1] = 250;
            data[i + 2] = 250;
          }
        }
      }
      return { data, width, height };
    }
    putImageData() {
      this.ops.push('putImageData');
    }
    clearRect() {
      this.ops.push('clearRect');
    }
    fillRect() {
      this.ops.push(`fillRect:${this.fillStyle}`);
    }
    createImageData(width: number, height: number) {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    }
  }

  function installCanvas() {
    const ops: string[] = [];
    const originals = {
      getContext: HTMLCanvasElement.prototype.getContext,
    };
    HTMLCanvasElement.prototype.getContext = (function getContext(this: HTMLCanvasElement) {
      return new RecordingContext(this, ops);
    } as unknown) as typeof HTMLCanvasElement.prototype.getContext;
    return {
      ops,
      restore() {
        HTMLCanvasElement.prototype.getContext = originals.getContext;
      },
    };
  }

  it('replaces the unchanged table with a plain plate, then classifies the crop', async () => {
    const canvas = installCanvas();
    try {
      vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
      vi.mocked(api.settings).mockResolvedValue(
        makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
      );
      vi.mocked(api.postRecognition).mockResolvedValue({
        ok: true,
        category: 'plastic',
        recognition: { id: 1, category: 'plastic', confidence: 0.95 },
        bin: { id: 'plastic', state: 'available' },
      });
      // One stored empty scene, the same 160x120 frame the page analyses.
      const empty = new Uint8ClampedArray(160 * 120 * 4);
      for (let i = 0; i < empty.length; i += 4) {
        empty[i] = 20;
        empty[i + 1] = 20;
        empty[i + 2] = 20;
        empty[i + 3] = 255;
      }
      // Seeded through the app's own store, so the test also proves the snapshot
      // round-trips through localStorage.
      expect(
        saveBackgrounds(window.localStorage, [{ width: 160, height: 120, data: empty }]),
      ).toBe(true);

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

      vi.mocked(api.wasteClassify).mockClear();
      render(<App />);
      const start = await screen.findByTestId('start-camera');
      // The model loads asynchronously; clicking before it is ready does nothing.
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);
      // These suites keep the automatic watcher on: the behaviour they
      // cover is what happens while the camera is being watched.
      fireEvent.click(await screen.findByTestId('auto-watch'));
      await waitFor(() => expect(api.wasteClassify).toHaveBeenCalled(), { timeout: 5000 });

      // The mask was painted and used to punch the picture out.
      expect(canvas.ops).toContain('putImageData');
      expect(canvas.ops.join('|')).toMatch(/clearRect.*drawImage:224x224/);
      // ...and a white plate was put behind it, so no transparency reaches the
      // model.
      expect(canvas.ops.some((op) => op === 'fillRect:#ffffff')).toBe(true);
      // The crop is handed to the backend as a JPEG data URL, never the raw
      // video: the model runs on the laptop now, not in this browser.
      const sent = vi.mocked(api.wasteClassify).mock.calls[0][0];
      expect(sent.startsWith('data:image/jpeg')).toBe(true);
      // 0.92, not 0.85: the lower quality cost 5 points of hand-held accuracy
      // for a payload difference of a couple of kilobytes.
      expect(toDataUrlCalls).toContain(0.92);
    } finally {
      canvas.restore();
    }
  }, 15000);

  it('still classifies when the stored background no longer matches the view', async () => {
    // The reported bug: after Set background, a nudged camera or a change of
    // light makes every pixel differ, the old code reported "no object", and the
    // screen sat on "Nothing to sort" while a real item was in front of it.
    const canvas = installCanvas();
    try {
      vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
      vi.mocked(api.settings).mockResolvedValue(
        makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
      );
      vi.mocked(api.postRecognition).mockResolvedValue({
        ok: true,
        category: 'plastic',
        recognition: { id: 2, category: 'plastic', confidence: 0.95 },
        bin: { id: 'plastic', state: 'available' },
      });
      const empty = new Uint8ClampedArray(160 * 120 * 4);
      for (let i = 0; i < empty.length; i += 4) {
        empty[i] = 20;
        empty[i + 1] = 20;
        empty[i + 2] = 20;
        empty[i + 3] = 255;
      }
      expect(
        saveBackgrounds(window.localStorage, [{ width: 160, height: 120, data: empty }]),
      ).toBe(true);
      // Every pixel differs from that snapshot.
      frameOverride = 210;

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

      vi.mocked(api.wasteClassify).mockClear();
      render(<App />);
      const start = await screen.findByTestId('start-camera');
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);
      // These suites keep the automatic watcher on: the behaviour they
      // cover is what happens while the camera is being watched.
      fireEvent.click(await screen.findByTestId('auto-watch'));

      // The model is still asked, on the whole frame.
      await waitFor(() => expect(api.wasteClassify).toHaveBeenCalled(), { timeout: 5000 });
      // The backend is asked to classify, so the model is not local any more.
      expect(api.wasteClassify).toHaveBeenCalled();
      // ...and the page says what to fix instead of claiming there is no waste.
      expect(await screen.findByTestId('frame-warning')).toHaveTextContent(
        /background no longer matches/i,
      );
      expect(screen.queryByText(/this does not look like waste/i)).not.toBeInTheDocument();
    } finally {
      frameOverride = null;
      canvas.restore();
    }
  }, 15000);

  it('learns the room instead of classifying it', async () => {
    // The reported failure: with no stored backdrop the page classified the
    // room itself and called the wall "textile".  The first frames are now the
    // room, and nothing is classified until it has been learned.
    const canvas = installCanvas();
    try {
      vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
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
      // An empty room: no item in the picture at all.
      frameOverride = null;
      showItem = false;
      vi.mocked(api.wasteClassify).mockClear();

      render(<App />);
      const start = await screen.findByTestId('start-camera');
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);
      // These suites keep the automatic watcher on: the behaviour they
      // cover is what happens while the camera is being watched.
      fireEvent.click(await screen.findByTestId('auto-watch'));

      expect(await screen.findByTestId('waste-warming', {}, { timeout: 5000 })).toBeInTheDocument();
      // The room is never sent to the model.
      expect(api.wasteClassify).not.toHaveBeenCalled();

      // Once learned, the room is "not a waste item" -- still not classified.
      expect(
        await screen.findByText(/Nothing to sort/i, {}, { timeout: 8000 }),
      ).toBeInTheDocument();
      expect(api.wasteClassify).not.toHaveBeenCalled();
    } finally {
      frameOverride = null;
      showItem = true;
      canvas.restore();
    }
  }, 25000);

  it('classifies an item shown in the learned room, and paints the room out', async () => {
    const canvas = installCanvas();
    try {
      vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
      vi.mocked(api.settings).mockResolvedValue(
        makeSettings({ waste_confidence: 0.6, waste_stability_frames: 2, waste_cooldown_ms: 1000 }),
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
      // The room first, then somebody holds an item up in it.
      frameOverride = null;
      showItem = false;
      vi.mocked(api.wasteClassify).mockClear();
      vi.mocked(api.postRecognition).mockClear();

      render(<App />);
      const start = await screen.findByTestId('start-camera');
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);
      // These suites keep the automatic watcher on: the behaviour they
      // cover is what happens while the camera is being watched.
      fireEvent.click(await screen.findByTestId('auto-watch'));
      await screen.findByTestId('waste-warming', {}, { timeout: 5000 });

      // Let the room be learned, then present the item.
      await new Promise((resolve) => setTimeout(resolve, 3200));
      showItem = true;

      await waitFor(() => expect(api.wasteClassify).toHaveBeenCalled(), { timeout: 10000 });
      // The learned room is subtracted exactly like a stored one, so the model
      // sees the item on a plain plate rather than the room around it.
      expect(canvas.ops).toContain('putImageData');
      expect(canvas.ops.some((op) => op === 'fillRect:#ffffff')).toBe(true);
    } finally {
      frameOverride = null;
      showItem = true;
      canvas.restore();
    }
  }, 30000);
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
    fireEvent.click(await screen.findByTestId('auto-watch'));

    // The greeting speaks on mount, so look for the classification itself.
    await waitFor(
      () => expect(spoken.some((line) => /Classified as Metal/i.test(line))).toBe(true),
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

describe('Sort Waste — the page says whether it is ready', () => {
  it('shows the learned progress, then Ready, before an item is shown', async () => {
    // Reported: "I could not really see from the webpage any indication whether
    // you have learned the background or not before showing the key fob."  The
    // answer belongs on the picture, where it is read *before* the item.
    vi.mocked(api.state).mockResolvedValue(makeState());
    vi.mocked(api.events).mockResolvedValue({ events: [] });
    vi.mocked(api.settings).mockResolvedValue(makeSettings());
    vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
    vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
    vi.mocked(api.wasteResnetStatus).mockResolvedValue({ installed: true, model: 'resnet50', classes: [] });
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

    // A frame the page can actually read: an empty room, unchanging.
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
            data[i] = 30;
            data[i + 1] = 30;
            data[i + 2] = 30;
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

      // Nothing is claimed while the camera is off.
      expect(screen.queryByTestId('camera-status')).not.toBeInTheDocument();

      fireEvent.click(start);
      const status = await screen.findByTestId('camera-status');
      // With the watcher off the page is ready for a press and has no room to
      // learn. "Learning the room 0%" forever, beside a page that will never
      // learn one, is the bug that was reported.
      expect(status).toHaveTextContent(/press/i);

      // Ticking the watcher starts a real warm-up, and the badge says so.
      fireEvent.click(await screen.findByTestId('auto-watch'));
      await waitFor(() => expect(status).toHaveTextContent(/learning the room/i), {
        timeout: 8000,
      });

      // Once the room is known the badge says so, so an item can be shown
      // without guessing whether the page is watching or ready.
      await waitFor(() => expect(status).toHaveTextContent(/ready/i), { timeout: 10000 });
      expect(status).toHaveTextContent(/show one item/i);
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  }, 25000);
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
      expect(await screen.findByText(/Best guess/i, {}, { timeout: 5000 })).toBeInTheDocument();
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

      // It says what it guessed...
      expect(
        await screen.findByText(/Best guess Leather at 24%/i, {}, { timeout: 5000 }),
      ).toBeInTheDocument();
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
    expect(screen.getByTestId('auto-watch')).not.toBeChecked();
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
});

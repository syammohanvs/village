import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const { predictMock, loadMock, predictionState } = vi.hoisted(() => {
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
  const predictMock = vi.fn(async (..._args: unknown[]) => state.current);
  const loadMock = vi.fn(async () => ({ predict: predictMock }));
  return { predictMock, loadMock, predictionState: state };
});

vi.mock('@teachablemachine/image', () => ({ load: loadMock }));
vi.mock('@tensorflow/tfjs', () => ({}));

beforeEach(() => {
  window.history.pushState({}, '', '/waste');
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.events).mockResolvedValue({ events: [] });
  vi.mocked(api.settings).mockResolvedValue(makeSettings());
  vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
  vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
  vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: false, path: '/models/waste/' });
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
    vi.mocked(api.wasteModelStatus).mockRejectedValue(new Error('backend down'));
    render(<App />);

    expect(await screen.findByText(/Model status could not be checked/i)).toBeInTheDocument();
    expect(screen.getByText(/backend down/)).toBeInTheDocument();
  });

  it('enables the camera when the model is installed and hides tuning under details', async () => {
    vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
    render(<App />);

    expect(await screen.findByRole('button', { name: /start camera/i })).toBeEnabled();
    expect(screen.getByText('How it works')).toBeInTheDocument();
    expect(screen.getByText('Confidence and model details')).toBeInTheDocument();
    expect(screen.getByText(/does not identify people/i)).toBeInTheDocument();
  });

  it('ranks what the model reported and calls predict without the flipped flag', async () => {
    vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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
    fireEvent.click(await screen.findByTestId('start-camera'));

    await waitFor(() => expect(predictMock).toHaveBeenCalled(), { timeout: 4000 });
    // predict(image, flipped) returns every class; passing a count mirrored the
    // frame and made '3' look like a page size.
    expect(predictMock.mock.calls[0]).toHaveLength(1);
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
    vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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
    fireEvent.click(await screen.findByTestId('start-camera'));

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
    vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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
    fireEvent.click(await screen.findByTestId('start-camera'));

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
    vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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
    vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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
    fireEvent.click(await screen.findByTestId('start-camera'));

    expect(await screen.findByTestId('set-background')).toBeInTheDocument();
    expect(screen.getByLabelText(/Focus on the object/i)).toBeChecked();
    expect(screen.getByText(/Show the empty table/i)).toBeInTheDocument();
  }, 15000);

  it('treats background and ordinary objects as nothing to sort, with no recognition', async () => {
    vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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
    fireEvent.click(await screen.findByTestId('start-camera'));

    expect(await screen.findByText(/Nothing to sort/i, {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('.prediction-list li'));
      expect(rows[0].textContent).toContain('Not a waste item');
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(api.postRecognition).not.toHaveBeenCalled();
    expect(screen.queryByTestId('waste-result')).not.toBeInTheDocument();
    expect(screen.queryByTestId('waste-referral')).not.toBeInTheDocument();
  }, 15000);

  it('accepts a split recycler vote as one recycling outcome', async () => {
    vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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
    fireEvent.click(await screen.findByTestId('start-camera'));

    await waitFor(() => expect(api.postRecognition).toHaveBeenCalled(), { timeout: 6000 });
    const splitCall = vi.mocked(api.postRecognition).mock.calls[0][0];
    expect(splitCall.category).toBe('other');
    expect(splitCall.confidence).toBeCloseTo(0.86, 6);
    expect(await screen.findByTestId('waste-result')).toHaveTextContent('Electronic waste');
    expect(screen.getByTestId('waste-referral')).toHaveTextContent(/recycling agent/i);
  }, 15000);

  it('keeps the camera running and arms itself for the next item', async () => {
    vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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
    fireEvent.click(await screen.findByTestId('start-camera'));

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
    vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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
      if (frameOverride === null) {
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
      vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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

      predictMock.mockClear();
      render(<App />);
      const start = await screen.findByTestId('start-camera');
      // The model loads asynchronously; clicking before it is ready does nothing.
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);
      await waitFor(() => expect(predictMock).toHaveBeenCalled(), { timeout: 5000 });

      // The mask was painted and used to punch the picture out.
      expect(canvas.ops).toContain('putImageData');
      expect(canvas.ops.join('|')).toMatch(/clearRect.*drawImage:224x224/);
      // ...and a white plate was put behind it, so no transparency reaches the
      // model.
      expect(canvas.ops.some((op) => op === 'fillRect:#ffffff')).toBe(true);
      // The classifier is handed the 224x224 crop, never the raw video.
      const input = predictMock.mock.calls[0][0] as unknown as HTMLCanvasElement;
      expect(input.tagName).toBe('CANVAS');
      expect(input.width).toBe(224);
      expect(input.height).toBe(224);
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
      vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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

      predictMock.mockClear();
      render(<App />);
      const start = await screen.findByTestId('start-camera');
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);

      // The model is still asked, on the whole frame.
      await waitFor(() => expect(predictMock).toHaveBeenCalled(), { timeout: 5000 });
      const input = predictMock.mock.calls[0][0] as unknown as HTMLVideoElement;
      expect(input.tagName).toBe('VIDEO');
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

  it('leaves the picture alone when no empty scene has been stored', async () => {
    const canvas = installCanvas();
    try {
      vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true, path: '/models/waste/' });
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
      predictMock.mockClear();
      render(<App />);
      const start = await screen.findByTestId('start-camera');
      // The model loads asynchronously; clicking before it is ready does nothing.
      await waitFor(() => expect(start).toBeEnabled(), { timeout: 5000 });
      fireEvent.click(start);
      await waitFor(() => expect(predictMock).toHaveBeenCalled(), { timeout: 5000 });

      expect(canvas.ops).not.toContain('putImageData');
      expect(canvas.ops.some((op) => op === 'fillRect:#ffffff')).toBe(false);
    } finally {
      canvas.restore();
    }
  }, 15000);
});

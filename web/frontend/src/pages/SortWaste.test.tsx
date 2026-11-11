import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  const predictMock = vi.fn(async () => state.current);
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

    // One item per camera session: the track is stopped and the page offers a
    // fresh Start Camera while the result stays on screen.
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
    expect(screen.getByTestId('start-camera')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /stop camera/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('waste-camera-stopped')).toHaveTextContent(
      /camera stopped after this item/i,
    );
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
    expect(vi.mocked(api.postRecognition).mock.calls[0][0]).toMatchObject({
      category: 'other',
      confidence: 0.9,
    });
    expect(await screen.findByTestId('waste-result')).toHaveTextContent('Glass');
    expect(screen.getByTestId('waste-referral')).toHaveTextContent(/recycling agent/i);
    expect(screen.getByTestId('waste-referral')).toHaveTextContent(/contact the operator/i);
    expect(screen.queryByText(/Put it in the glass bin/i)).not.toBeInTheDocument();
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
  }, 15000);
});

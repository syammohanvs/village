import { render, screen } from '@testing-library/react';
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
      voiceReadiness: vi.fn(),
      voiceIntents: vi.fn(),
      events: vi.fn(),
    },
  };
});

beforeEach(() => {
  window.history.pushState({}, '', '/waste');
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.events).mockResolvedValue({ events: [] });
  vi.mocked(api.settings).mockResolvedValue(makeSettings());
  vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
  vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
  vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: false, path: '/models/waste/' });
});

describe('Sort Waste', () => {
  it('says the model is missing and keeps the camera off instead of guessing', async () => {
    render(<App />);

    expect(await screen.findByText(/Recognition model is missing/i)).toBeInTheDocument();
    expect(screen.getByText(/The camera stays off until the recognition model is installed/i)).toBeInTheDocument();

    const start = screen.getByRole('button', { name: /start camera/i });
    expect(start).toBeDisabled();
    expect(screen.queryByText(/\d+% confidence/i)).not.toBeInTheDocument();
  });

  it('names an unavailable service separately from a missing model', async () => {
    vi.mocked(api.wasteModelStatus).mockRejectedValue(new Error('backend down'));
    render(<App />);

    expect(await screen.findByText(/Recognition service unavailable/i)).toBeInTheDocument();
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
});

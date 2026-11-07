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
    },
  };
});

beforeEach(() => {
  window.history.pushState({}, '', '/waste');
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.settings).mockResolvedValue(makeSettings());
  vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
  vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
  vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: false, path: '/models/waste/' });
});

describe('Waste camera page', () => {
  it('says the model is missing instead of inventing predictions', async () => {
    render(<App />);

    expect((await screen.findAllByText('Recognition model not installed')).length).toBeGreaterThan(0);
    expect(screen.getByText('No predictions')).toBeInTheDocument();
    expect(screen.getAllByText(/models\/waste\//).length).toBeGreaterThan(0);
    expect(screen.queryByText(/top predictions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+% confidence/i)).not.toBeInTheDocument();

    const start = screen.getByRole('button', { name: /start camera/i });
    expect(start).toBeDisabled();
  });
});

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
  window.history.pushState({}, '', '/activity');
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.settings).mockResolvedValue(makeSettings());
  vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: false });
  vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
  vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [] });
});

describe('What happened', () => {
  it('says the history is unavailable instead of claiming nothing happened', async () => {
    vi.mocked(api.events).mockRejectedValue(new Error('backend down'));
    render(<App />);

    expect(await screen.findByText(/Something did not answer/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing has happened yet/i)).not.toBeInTheDocument();
  });

  it('says nothing has happened only when the history was read and is empty', async () => {
    vi.mocked(api.events).mockResolvedValue({ events: [] });
    render(<App />);

    expect(await screen.findByText(/Nothing has happened yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Something did not answer/i)).not.toBeInTheDocument();
  });
});

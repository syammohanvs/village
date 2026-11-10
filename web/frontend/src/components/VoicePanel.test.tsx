import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      sendCommand: vi.fn(),
      voiceReadiness: vi.fn(),
      wasteModelStatus: vi.fn(),
      voiceIntents: vi.fn(),
      settings: vi.fn(),
      voiceTranscribe: vi.fn(),
      events: vi.fn(),
    },
  };
});

vi.mock('../lib/audio', () => ({
  recordingSupported: () => true,
  VoiceRecorder: class {
    async start() {
      /* ready */
    }
    async stop() {
      return new Blob(['fake-wav'], { type: 'audio/wav' });
    }
    cancel() {
      /* nothing */
    }
  },
}));

vi.mock('../lib/speech', () => ({
  speechSupported: () => true,
  stopSpeaking: vi.fn(),
  speakText: vi.fn(async () => undefined),
  speakReply: vi.fn(async () => 'none'),
  voiceAvailable: () => true,
}));

async function openPanel() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByTestId('start-voice'));
  return { user, panel: await screen.findByTestId('voice-panel') };
}

beforeEach(() => {
  window.history.pushState({}, '', '/');
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.settings).mockResolvedValue(makeSettings({ tts_enabled: false }));
  vi.mocked(api.voiceReadiness).mockResolvedValue({
    ready: true,
    whisper: { ready: true, model: 'ggml-base.bin' },
    unavailable_languages: [],
  });
  vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true });
  vi.mocked(api.events).mockResolvedValue({ events: [] });
  vi.mocked(api.voiceIntents).mockResolvedValue({
    intents: [
      {
        id: 'LIGHTS_OFF',
        command: 'LIGHTS_OFF',
        actuation: true,
        label: { en: 'Lights off' },
        phrases: { en: ['switch off the lights'] },
      },
    ],
    help_order: ['LIGHTS_OFF'],
  });
  vi.mocked(api.sendCommand).mockResolvedValue({
    confirmed: true,
    mode: 'live',
    physical: true,
    ack: { result: 'ACCEPTED', reason_code: 'LIGHTS_OFF', reason: 'The lights were switched off.' },
    error: null,
  });
});

describe('Voice panel', () => {
  it('shows an unknown result and sends no command', async () => {
    vi.mocked(api.voiceTranscribe).mockResolvedValue({
      status: 'unknown',
      intent: 'UNKNOWN',
      command: null,
      text: 'open the gate',
      message: 'Unsupported request. No command was sent.',
    });

    const { user, panel } = await openPanel();
    await user.click(screen.getByTestId('voice-start'));
    await user.click(await screen.findByRole('button', { name: /stop recording/i }));

    expect(await screen.findByText('Unsupported request. No command was sent.')).toBeInTheDocument();
    expect(screen.getByText(/open the gate/)).toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
    expect(panel).toBeInTheDocument();
  });

  it('sends exactly one LIGHTS_OFF command for a matched actuation intent', async () => {
    vi.mocked(api.voiceTranscribe).mockResolvedValue({
      status: 'ok',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      text: 'switch off the lights',
      message: 'Turning the lights off.',
    });

    const { user } = await openPanel();
    await user.click(screen.getByTestId('voice-start'));
    await user.click(await screen.findByRole('button', { name: /stop recording/i }));

    await waitFor(() =>
      expect(api.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LIGHTS_OFF', source: 'voice' }),
      ),
    );
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/switch off the lights/).length).toBeGreaterThan(0);
    expect(await screen.findByTestId('voice-command-outcome')).toHaveTextContent(/confirmed/i);
  });
});

describe('Voice panel language and readiness', () => {
  it('keeps the example phrases in the selected language when the service is down', async () => {
    vi.mocked(api.voiceIntents).mockRejectedValue(new Error('service down'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('start-voice'));
    const panel = await screen.findByTestId('voice-panel');

    // The shared pill selector, not a browser-default button.
    const ml = await screen.findByTestId('voice-lang-ml');
    expect(ml.className).toContain('lang-pill');

    await user.click(ml);
    const list = panel.querySelector('.voice-help');
    expect(list?.textContent).toMatch(/വിളക്കുകൾ കത്തിക്കുക/);
    expect(list?.textContent).not.toMatch(/Lights on/);
  });

  it('names a disconnected board separately from a missing speech service', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ connected: false, stale: false }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('start-voice'));

    const readiness = await screen.findByTestId('voice-readiness');
    expect(readiness).toHaveTextContent('Board offline');
    expect(readiness).toHaveTextContent(/The board is disconnected/);
    expect(screen.getByTestId('voice-start')).toBeDisabled();
  });

  it('disables recording when the speech service is down and says why', async () => {
    vi.mocked(api.voiceReadiness).mockResolvedValue({
      ready: false,
      whisper: { ready: false, message: 'the local model is missing.' },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('start-voice'));

    const readiness = await screen.findByTestId('voice-readiness');
    expect(readiness).toHaveTextContent('Speech service unavailable');
    expect(readiness).toHaveTextContent(/the local model is missing/);
    expect(screen.getByTestId('voice-start')).toBeDisabled();
  });
});

describe('Voice panel keyboard behaviour', () => {
  it('takes focus when opened, closes on Escape and gives focus back', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = await screen.findByTestId('start-voice');
    await user.click(trigger);

    const panel = await screen.findByTestId('voice-panel');
    expect(panel).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('voice-panel')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

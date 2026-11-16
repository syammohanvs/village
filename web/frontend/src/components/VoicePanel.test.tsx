import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      session: vi.fn(),
      voiceTranscribe: vi.fn(),
      voiceInterpret: vi.fn(),
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
  primeVoices: vi.fn(async () => []),
  speakText: vi.fn(async () => true),
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
  vi.mocked(api.session).mockResolvedValue({
    authenticated: true,
    username: null,
    auth_enabled: false,
  });

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
    // The lamps must be on, or the panel correctly answers "already off".
    vi.mocked(api.state).mockResolvedValue(makeState({ lightsCommanded: true }));
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

describe('voice replies', () => {
  beforeEach(() => {
    vi.mocked(api.voiceIntents).mockResolvedValue({
      intents: [
        {
          id: 'VILLAGE_STATUS',
          command: null,
          actuation: false,
          label: { en: 'Village status' },
          phrases: { en: ['village status'] },
        },
      ],
      help_order: ['VILLAGE_STATUS'],
    });
  });

  it('reads the catalogue answer for an answer-only intent instead of a shrug', async () => {
    vi.mocked(api.voiceTranscribe).mockResolvedValue({
      status: 'ok',
      intent: 'VILLAGE_STATUS',
      command: null,
      actuation: false,
      text: 'village status',
      response_text: 'The village is running. The screen shows the current readings.',
    });

    const { user } = await openPanel();
    await user.click(screen.getByTestId('voice-start'));
    await user.click(await screen.findByRole('button', { name: /stop recording/i }));

    // The frame is available in this test, so the live summary replaces the
    // canned sentence — either way it must not be the generic "does not move
    // anything" line.
    expect(await screen.findByText(/The soil|The tank|The village is running/)).toBeInTheDocument();
    expect(screen.queryByText(/does not move anything/)).not.toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('speaks the done text once the controller confirms a command', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ lightsCommanded: true }));
    vi.mocked(api.settings).mockResolvedValue(makeSettings({ tts_enabled: true }));
    vi.mocked(api.voiceTranscribe).mockResolvedValue({
      status: 'ok',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      text: 'lights off',
      pending_text: 'Turning the streetlights off.',
      done_text: 'The streetlights are off.',
    });
    const speech = await import('../lib/speech');
    vi.mocked(speech.speakReply).mockClear();

    const { user } = await openPanel();
    await user.click(screen.getByTestId('voice-start'));
    await user.click(await screen.findByRole('button', { name: /stop recording/i }));

    await waitFor(() =>
      expect(speech.speakReply).toHaveBeenCalledWith(
        expect.stringMatching(/streetlights are off|The lights were switched off/i),
        expect.anything(),
        expect.anything(),
      ),
    );
    // The screen states the confirmed outcome too, not just the intention.
    expect(await screen.findByText('The streetlights are off.')).toBeInTheDocument();
  });
});

describe('typed requests use the same parser', () => {
  it('sends one command for typed words, and shows the transcript', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ lightsCommanded: true }));
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      transcript: 'please switch the lights off',
      pending_text: 'Switching the lights off.',
      done_text: 'The lights are off.',
    });

    const { user } = await openPanel();
    await user.type(screen.getByTestId('voice-text'), 'please switch the lights off');
    await user.click(screen.getByTestId('voice-send'));

    await waitFor(() =>
      expect(api.voiceInterpret).toHaveBeenCalledWith('please switch the lights off', 'en'),
    );
    await waitFor(() =>
      expect(api.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LIGHTS_OFF', source: 'voice' }),
      ),
    );
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/please switch the lights off/).length).toBeGreaterThan(0);
  });

  it('processes one submission once, and lets a later repetition run', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ lightsCommanded: true }));
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      transcript: 'switch off the lights',
      pending_text: 'Switching the lights off.',
      done_text: 'The lights are off.',
    });

    const { user } = await openPanel();
    const box = screen.getByTestId('voice-text');
    await user.type(box, 'switch off the lights');

    // Two submit events for one gesture (double click, duplicate event) must
    // not become two commands.
    const form = screen.getByTestId('voice-send').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(1));
    expect(api.voiceInterpret).toHaveBeenCalledTimes(1);

    // A later, deliberate repetition is a new intent and does run.
    await user.type(screen.getByTestId('voice-text'), 'switch off the lights');
    await user.click(screen.getByTestId('voice-send'));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(2));
  });

  it('answers a status question without sending anything', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ lightsCommanded: false }));
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'status',
      intent: 'LIGHTS_STATUS',
      command: null,
      actuation: false,
      transcript: 'are the lights off',
      response_text: 'The Streets card shows whether the lamps are on.',
    });

    const { user } = await openPanel();
    await user.type(screen.getByTestId('voice-text'), 'are the lights off');
    await user.click(screen.getByTestId('voice-send'));

    expect(await screen.findByText(/street lights are off/i)).toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('does not trust a stale frame when deciding the lights are already off', async () => {
    // A cached frame says "off"; the board itself is stale, so the request must
    // still be sent rather than answered from the cache.
    vi.mocked(api.state).mockResolvedValue(
      makeState({ stale: true, ageMs: 9000, lightsCommanded: false }),
    );
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      transcript: 'turn the lights off',
      already_text: 'The lights are already off.',
      pending_text: 'Switching the lights off.',
    });

    const { user } = await openPanel();
    await user.type(screen.getByTestId('voice-text'), 'turn the lights off');
    await user.click(screen.getByTestId('voice-send'));

    await waitFor(() =>
      expect(api.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LIGHTS_OFF', source: 'voice' }),
      ),
    );
    expect(screen.queryByText('The lights are already off.')).not.toBeInTheDocument();
  });

  it('says a command already holds instead of sending it again', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ lightsCommanded: false, lightsMode: 'manual_off' }),
    );
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      transcript: 'turn the lights off',
      already_text: 'The lights are already off.',
      pending_text: 'Switching the lights off.',
    });

    const { user } = await openPanel();
    await user.type(screen.getByTestId('voice-text'), 'turn the lights off');
    await user.click(screen.getByTestId('voice-send'));

    expect(await screen.findByText('The lights are already off.')).toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('still sends "lights on" while Auto happens to have them on', async () => {
    // Auto + dark: the lamps ARE on, but by the light sensor's decision.  Saying
    // "lights on" asks for them to be held on, so it must reach the controller
    // -- otherwise the LDR switches them off again the moment it gets bright,
    // and the visitor's command was silently dropped.
    vi.mocked(api.state).mockResolvedValue(
      makeState({ lightsCommanded: true, lightsMode: 'auto' }),
    );
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_ON',
      command: 'LIGHTS_ON',
      actuation: true,
      transcript: 'turn the lights on',
      already_text: 'The lights are already on.',
      pending_text: 'Switching the lights on.',
    });

    const { user } = await openPanel();
    await user.type(screen.getByTestId('voice-text'), 'turn the lights on');
    await user.click(screen.getByTestId('voice-send'));

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalled());
    expect(vi.mocked(api.sendCommand).mock.calls.at(-1)![0]).toMatchObject({ type: 'LIGHTS_ON' });
    expect(screen.queryByText('The lights are already on.')).not.toBeInTheDocument();
  });

  it('does not re-send "lights on" when the lamps are already held on', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ lightsCommanded: true, lightsMode: 'manual_on' }),
    );
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_ON',
      command: 'LIGHTS_ON',
      actuation: true,
      transcript: 'turn the lights on',
      already_text: 'The lights are already on.',
      pending_text: 'Switching the lights on.',
    });

    const { user } = await openPanel();
    await user.type(screen.getByTestId('voice-text'), 'turn the lights on');
    await user.click(screen.getByTestId('voice-send'));

    expect(await screen.findByText('The lights are already on.')).toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('refuses to act when the controller is unreachable', async () => {
    vi.mocked(api.state).mockResolvedValue(
      // Lamps on, so the request is not short-circuited by "already off".
      makeState({ connected: false, stale: false, ageMs: 15000, lightsCommanded: true }),
    );
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      transcript: 'lights off',
      pending_text: 'Switching the lights off.',
    });

    const { user } = await openPanel();
    await user.type(screen.getByTestId('voice-text'), 'lights off');
    await user.click(screen.getByTestId('voice-send'));

    expect(
      await screen.findByText(/I can't reach the village controller/i),
    ).toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('never announces success when the controller does not confirm', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ lightsCommanded: true }));
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      transcript: 'lights off',
      pending_text: 'Switching the lights off.',
      done_text: 'The lights are off.',
    });
    vi.mocked(api.sendCommand).mockResolvedValue({
      confirmed: false,
      mode: 'live',
      physical: true,
      ack: null,
      error: null,
    });

    const { user } = await openPanel();
    await user.type(screen.getByTestId('voice-text'), 'lights off');
    await user.click(screen.getByTestId('voice-send'));

    expect(await screen.findByText(/did not confirm/i)).toBeInTheDocument();
    expect(screen.queryByText('The lights are off.')).not.toBeInTheDocument();
  });

  it('shows the controller’s own reason when it rejects watering', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ lightsCommanded: false }));
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'IRRIGATION_START',
      command: 'IRRIGATION_REQUEST',
      actuation: true,
      transcript: 'water the plants',
      pending_text: 'Sending the irrigation request to the controller.',
      done_text: 'The controller accepted the irrigation request.',
    });
    vi.mocked(api.sendCommand).mockResolvedValue({
      confirmed: true,
      mode: 'live',
      physical: true,
      ack: {
        result: 'REJECTED',
        reason_code: 'IRRIGATION_BLOCKED_LOW_WATER',
        reason: 'Irrigation blocked: reservoir water is low.',
      },
      error: null,
    });

    const { user } = await openPanel();
    await user.type(screen.getByTestId('voice-text'), 'water the plants');
    await user.click(screen.getByTestId('voice-send'));

    // The reason appears in the message and the outcome line; either is fine.
    expect(
      (await screen.findAllByText(/Irrigation blocked: reservoir water is low/i)).length,
    ).toBeGreaterThan(0);
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
  });

  it('says the model does not measure bin fullness', async () => {
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'status',
      intent: 'BIN_STATUS',
      command: null,
      actuation: false,
      transcript: 'are the bins full',
      response_text:
        'Our model does not measure bin fullness. The three bins have indicator LEDs only.',
    });

    const { user } = await openPanel();
    await user.type(screen.getByTestId('voice-text'), 'are the bins full');
    await user.click(screen.getByTestId('voice-send'));

    expect(
      await screen.findByText(/does not measure bin fullness/i),
    ).toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('does not act on a statement or a hypothetical question', async () => {
    const { user } = await openPanel();
    for (const [text, message] of [
      ['the lights are off', "Understood — I haven't changed anything."],
      ['what happens if I switch the lights off', 'I only act when you ask me to.'],
    ]) {
      vi.mocked(api.voiceInterpret).mockResolvedValue({
        status: 'statement',
        kind: text.startsWith('what') ? 'hypothetical' : 'statement',
        intent: text.startsWith('what') ? 'HYPOTHETICAL' : 'STATEMENT',
        command: null,
        actuation: false,
        transcript: text,
        message,
      });
      await user.type(screen.getByTestId('voice-text'), text);
      await user.click(screen.getByTestId('voice-send'));
      expect(await screen.findByText(message)).toBeInTheDocument();
    }
    expect(api.sendCommand).not.toHaveBeenCalled();
  });
});

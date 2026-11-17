import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  // Each test starts in the default language unless it says otherwise.
  window.localStorage.removeItem('village.voiceLanguage');
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
    // The stop label is in the panel's language, so press the same control.
    await user.click(screen.getByTestId('voice-start'));

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
    // The stop label is in the panel's language, so press the same control.
    await user.click(screen.getByTestId('voice-start'));

    await waitFor(() =>
      expect(api.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LIGHTS_OFF', source: 'voice' }),
      ),
    );
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/switch off the lights/).length).toBeGreaterThan(0);
    // The state word says confirmed, and a confirmation says nothing else: the
    // controller's English reason used to sit under a Malayalam reply, and it
    // was also what Sara tried to speak (2026-11-17).
    expect(await screen.findByTestId('voice-state-word')).toHaveTextContent(/confirmed/i);
    expect(screen.queryByTestId('voice-command-outcome')).not.toBeInTheDocument();
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
    const examples = panel.querySelector('.voice-examples-top');
    expect(examples?.textContent).toMatch(/വിളക്കുകൾ കത്തിക്കുക/);
    expect(examples?.textContent).not.toMatch(/Lights on/);
  });

  it('still listens while the board is away, and says that nothing will move', async () => {
    // Changed 2026-11-17 (reported with the board powered off): a dead
    // microphone with no explanation reads as "it is not listening".  The
    // sentence and the answer are still useful, and the panel already refuses
    // to act on a command it cannot deliver.
    vi.mocked(api.state).mockResolvedValue(makeState({ connected: false, stale: false }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('start-voice'));

    const readiness = await screen.findByTestId('voice-readiness');
    expect(readiness).toHaveTextContent('Board offline');
    expect(await screen.findByTestId('voice-offline-note')).toHaveTextContent(
      /nothing will move until it reconnects/i,
    );
    expect(screen.getByTestId('voice-start')).toBeEnabled();
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
    // The stop label is in the panel's language, so press the same control.
    await user.click(screen.getByTestId('voice-start'));

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
    // The stop label is in the panel's language, so press the same control.
    await user.click(screen.getByTestId('voice-start'));

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
      await screen.findByText(/I can.t reach the village controller/i),
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

describe('when the speech server is not running', () => {
  it('turns the microphone off and says why, at the control that is off', async () => {
    // The local whisper server is a separate process.  Without it nothing can
    // be transcribed, so the button must not look usable -- and it must name
    // the reason where the reader is looking (found 2026-11-17: the panel said
    // nothing at the button and pressing Start did nothing).
    vi.mocked(api.voiceReadiness).mockResolvedValue({
      ready: false,
      whisper: { ready: false, model: 'ggml-base.bin', message: 'Whisper server is not reachable.' },
      unavailable_languages: [],
    });

    await openPanel();

    const start = await screen.findByTestId('voice-start');
    await waitFor(() => expect(start).toBeDisabled());
    expect(start).toHaveAttribute('title', expect.stringContaining('speech service is not available'));
    expect(screen.getByTestId('voice-start')).toHaveTextContent(/microphone is off/i);
    // The reason is on screen as a sentence too, not only in a tooltip.
    expect(screen.getByText(/Whisper server is not reachable/i)).toBeInTheDocument();
  });

  it('asks again when the panel is reopened, so a started server brings the microphone back', async () => {
    // The panel and the guide both ask, so the answer is driven by a flag
    // rather than by call order.
    let serverUp = false;
    vi.mocked(api.voiceReadiness).mockImplementation(async () => ({
      ready: serverUp,
      whisper: serverUp
        ? { ready: true, model: 'ggml-base.bin' }
        : { ready: false, model: 'ggml-base.bin', message: 'Whisper server is not reachable.' },
      unavailable_languages: [],
    }));

    const { user } = await openPanel();
    await waitFor(() => expect(screen.getByTestId('voice-start')).toBeDisabled());

    serverUp = true;
    await user.click(screen.getByRole('button', { name: 'Close voice panel' }));
    await user.click(await screen.findByTestId('start-voice'));

    await waitFor(() => expect(screen.getByTestId('voice-start')).toBeEnabled());
  });
});

describe('Sara greets when the panel opens', () => {
  it('says who she is and asks how to help, in the chosen language', async () => {
    vi.mocked(api.settings).mockResolvedValue(makeSettings({ tts_enabled: true }));
    const speech = await import('../lib/speech');
    vi.mocked(speech.speakReply).mockClear();

    await openPanel();

    await waitFor(() =>
      expect(speech.speakReply).toHaveBeenCalledWith(
        'I am Sara. How may I help you?',
        'en',
        null,
      ),
    );
  });

  it('greets in Malayalam when Malayalam is the language chosen', async () => {
    vi.mocked(api.settings).mockResolvedValue(makeSettings({ tts_enabled: true }));
    const speech = await import('../lib/speech');
    vi.mocked(speech.speakReply).mockClear();

    // The language is chosen on the page before the panel opens: the greeting
    // is spoken once per opening, in whatever is chosen then.
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('invite-lang-ml'));
    await user.click(screen.getByTestId('start-voice'));

    await waitFor(() =>
      expect(speech.speakReply).toHaveBeenCalledWith(
        expect.stringContaining('ഞാൻ സാറയാണ്'),
        'ml',
        null,
      ),
    );
  });

  it('stays quiet when reading aloud is switched off', async () => {
    vi.mocked(api.settings).mockResolvedValue(makeSettings({ tts_enabled: false }));
    const speech = await import('../lib/speech');
    vi.mocked(speech.speakReply).mockClear();

    await openPanel();
    // Give the effect its chance, then assert nothing was spoken.
    await waitFor(() => expect(screen.getByTestId('voice-panel')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(speech.speakReply).not.toHaveBeenCalled();
  });
});

describe('a transcript that came back in the wrong script', () => {
  it('names it instead of pretending the sentence was understood', async () => {
    // Whisper answered Malayalam audio in Tamil script on this machine
    // (2026-11-17).  The parser can only say "not understood", so the panel
    // says what actually happened and keeps the heard sentence on screen.
    vi.mocked(api.voiceTranscribe).mockResolvedValue({
      status: 'unknown',
      kind: 'unknown',
      transcript: 'விலக்குகள் ஆனக்குக்கா',
    } as never);

    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('button', { name: /മലയാളം/ }));
    await user.click(screen.getByTestId('voice-start'));
    // The stop label is in the panel's language, so press the same control.
    await user.click(screen.getByTestId('voice-start'));

    // The note is written in the language the panel is in, so a Malayalam
    // visitor reads the explanation in Malayalam (it used to be English-only).
    const note = await screen.findByTestId('voice-script-note');
    expect(note).toHaveTextContent(/Malayalam വ്യക്തമായി കേട്ടില്ല/);
    // The words that were heard stay visible, so the reader can see why.
    expect(screen.getByTestId('voice-staged-text')).toHaveTextContent('விலக்குகள்');
  });
});

describe('a sister-script transcript the village could still read', () => {
  it('acts on it, and says nothing about the script', async () => {
    // The backend reads the words by sound now, so a Tamil spelling of a
    // Malayalam command is carried out.  An apology over a command that
    // worked would be its own confusion.
    vi.mocked(api.state).mockResolvedValue(makeState({ lightsCommanded: true }));
    vi.mocked(api.voiceTranscribe).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      transcript: 'விலக்குகள் ஆனக்குக்கா',
      pending_text: 'Turning the streetlights off.',
      done_text: 'The streetlights are off.',
    } as never);
    vi.mocked(api.sendCommand).mockResolvedValue({
      confirmed: true,
      mode: 'live',
      physical: true,
      error: null,
      ack: { result: 'ACCEPTED', reason_code: 'OK', reason: 'Accepted.' },
    } as never);

    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('button', { name: /മലയാളം/ }));
    await user.click(screen.getByTestId('voice-start'));
    // The stop label is in the panel's language, so press the same control.
    await user.click(screen.getByTestId('voice-start'));

    await waitFor(() =>
      expect(api.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LIGHTS_OFF', source: 'voice' }),
      ),
    );
    expect(screen.queryByTestId('voice-script-note')).not.toBeInTheDocument();
  });
});

/**
 * The panel's own words.  Asked for 2026-11-17: a visiting judge has to know
 * what the panel is for, and a Class 6 child has to be told what to say — so
 * every heading below is load-bearing, and the example explanations never name
 * an internal command.
 */
describe('the panel in plain words', () => {
  it('names itself and the two things it is for', async () => {
    const { panel } = await openPanel();

    expect(within(panel).getByRole('heading', { name: 'Talk to Sara' })).toBeInTheDocument();
    expect(
      within(panel).getByText('Ask Sara to control the village or check its status.'),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Your request')).toBeInTheDocument();
    expect(within(panel).getByText('Sara’s reply')).toBeInTheDocument();
    expect(within(panel).getByText('Or type your request')).toBeInTheDocument();
    expect(
      within(panel).getByText('You can type your request instead of speaking.'),
    ).toBeInTheDocument();
    expect(within(panel).getByText('Try saying…')).toBeInTheDocument();
  });

  it('says what it asks before anything has been said', async () => {
    const { panel } = await openPanel();
    expect(within(panel).getByTestId('voice-staged-text')).toHaveTextContent(
      'Your words will appear here.',
    );
    expect(within(panel).getByTestId('voice-reply-text')).toHaveTextContent(
      'Sara’s answer will appear here.',
    );
  });

  it('opens on three example sentences as buttons, above everything else', async () => {
    const { panel } = await openPanel();
    const examples = within(panel).getByTestId('voice-examples-top');

    // They are the first block under the heading — asked for 2026-11-18,
    // because a list at the foot of the panel was below the fold.
    expect(panel.firstElementChild?.nextElementSibling).toBe(examples);

    // The three cards only — the "More commands" toggle also lives in this
    // block, and it is not an example.
    const buttons = [...examples.querySelectorAll<HTMLButtonElement>('.voice-example-btn')];
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Streetlights on“Please turn on the lights.”',
      'Water in the tank“Is water available?”',
      'Soil moisture“What is the soil moisture?”',
    ]);

    // What a control says when it is hovered is the explanation, so the panel
    // still tells a visitor what a phrase does without a paragraph beside it.
    expect(buttons[0].getAttribute('title')).toBe(
      '“Please turn on the lights.” — Turns the streetlights on.',
    );

    // What a visitor must never be shown: the wire names, or a claim that a
    // question does nothing (a polite question *is* a command).
    expect(examples.textContent).not.toMatch(/LIGHTS_ON|IRRIGATION_|sends /i);
  });

  it('runs an example through the same parser a spoken sentence uses', async () => {
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'status',
      intent: 'WATER_STATUS',
      transcript: 'Is water available?',
      message: 'The dashboard shows which.',
    } as never);
    const { user, panel } = await openPanel();

    await user.click(within(panel).getByTestId('voice-example-water_status'));

    // The sentence it sent is the one shown as the request, so the visitor
    // learns the phrase by watching it work.
    await waitFor(() =>
      expect(within(panel).getByTestId('voice-staged-text')).toHaveTextContent(
        '“Is water available?”',
      ),
    );
    expect(api.voiceInterpret).toHaveBeenCalledWith('Is water available?', 'en');
    // …and it never opened the microphone to say it.
    expect(api.voiceTranscribe).not.toHaveBeenCalled();
  });

  it('opens the rest of the catalogue at the top, and each row is a command', async () => {
    const { user, panel } = await openPanel();
    const examples = within(panel).getByTestId('voice-examples-top');

    // It is not at the foot of the panel any more: on a smaller window the old
    // strip was not reachable at all (reported 2026-11-18).
    await user.click(within(examples).getByTestId('voice-more-toggle'));
    const list = within(examples).getByTestId('voice-more-list');
    expect(list).toBeInTheDocument();
    expect(within(list).getByText('Turns the streetlights off.')).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/LIGHTS_OFF|sends /i);

    // …and one press runs that sentence through the parser.
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      pending_text: 'Turning the streetlights off.',
      done_text: 'The streetlights are off.',
    } as never);
    const row = within(list).getByTestId('voice-more-lights_off');
    // The phrase on the row is the phrase that is sent — no second spelling.
    const phrase = row.querySelector('.help-phrase')?.textContent?.replace(/[“”]/g, '');
    expect(phrase).toBeTruthy();
    await user.click(row);
    await waitFor(() => expect(api.voiceInterpret).toHaveBeenCalledWith(phrase, 'en'));

    // Choosing a command closes the catalogue: the answer is what was asked for.
    expect(within(examples).queryByTestId('voice-more-list')).toBeNull();

    // …and the toggle is a toggle, not a one-way door.
    await user.click(within(examples).getByTestId('voice-more-toggle'));
    expect(within(examples).getByTestId('voice-more-toggle')).toHaveTextContent('Show fewer');
    await user.click(within(examples).getByTestId('voice-more-toggle'));
    expect(within(examples).queryByTestId('voice-more-list')).toBeNull();
  });

  it('translates every heading and example into the chosen language', async () => {
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('button', { name: /മലയാളം/ }));

    expect(within(panel).getByRole('heading', { name: 'സാറയോട് സംസാരിക്കുക' })).toBeInTheDocument();
    expect(within(panel).getByText('നിങ്ങളുടെ അഭിവാദനം'.replace('അഭിവാദനം', 'അഭ്യർത്ഥന'))).toBeInTheDocument();
    expect(within(panel).getByText('സാറയുടെ മറുപടി')).toBeInTheDocument();
    expect(within(panel).getByText('ഇത് പറഞ്ഞു നോക്കൂ…')).toBeInTheDocument();
    expect(within(panel).getByText('“ദയവായി വിളക്കുകൾ കത്തിക്കുക”')).toBeInTheDocument();
  });

  it('says Simulation means the model is not controlled', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    const { panel } = await openPanel();

    expect(within(panel).getByTestId('voice-simulation')).toHaveTextContent(
      'Simulation — physical model is not controlled.',
    );
  });

  it('answers a water question from the frame, not from a canned sentence', async () => {
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'status',
      intent: 'WATER_STATUS',
      command: null,
      message: 'The dashboard shows which.',
    } as never);
    const { user, panel } = await openPanel();

    await user.type(within(panel).getByTestId('voice-text'), 'is water available');
    await user.click(within(panel).getByTestId('voice-send'));

    expect(await within(panel).findByTestId('voice-reply-text')).toHaveTextContent(
      'There is water at the low level in the tank.',
    );
  });

  it('answers a soil question with the reading the card shows', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ soilPercent: 27.6, soilState: 'dry' }));
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'status',
      intent: 'SOIL_STATUS',
      command: null,
    } as never);
    const { user, panel } = await openPanel();

    await user.type(within(panel).getByTestId('voice-text'), 'soil moisture');
    await user.click(within(panel).getByTestId('voice-send'));

    expect(await within(panel).findByTestId('voice-reply-text')).toHaveTextContent(
      'The soil is dry (28%).',
    );
  });

  it('stops listening when the panel is closed mid-recording', async () => {
    // A microphone left open behind a closed panel records a room without
    // telling anyone it is doing it (asked for 2026-11-17).
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByTestId('voice-start'));
    expect(within(panel).getByTestId('voice-start')).toHaveAttribute(
      'aria-label',
      'Stop speaking',
    );

    await user.click(within(panel).getByRole('button', { name: 'Close voice panel' }));
    await user.click(await screen.findByTestId('start-voice'));

    const reopened = await screen.findByTestId('voice-panel');
    expect(within(reopened).getByTestId('voice-start')).toHaveAttribute(
      'aria-label',
      'Start speaking',
    );
  });

  it('keeps the reply but clears the request when a new recording starts', async () => {
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      pending_text: 'Turning the streetlights off.',
      done_text: 'The streetlights are off.',
    } as never);
    const { user, panel } = await openPanel();

    await user.type(within(panel).getByTestId('voice-text'), 'lights off');
    await user.click(within(panel).getByTestId('voice-send'));
    expect(await within(panel).findByTestId('voice-reply-text')).toHaveTextContent(
      'The streetlights are off.',
    );

    await user.click(within(panel).getByTestId('voice-start'));
    // The answer to the previous question stays…
    expect(within(panel).getByTestId('voice-reply-text')).toHaveTextContent(
      'The streetlights are off.',
    );
    // …but the request is the sentence being spoken *now*, so it empties
    // (asked 2026-11-18: the old command sat there while the visitor talked).
    expect(within(panel).getByTestId('voice-staged-text')).toHaveTextContent(/Listening/i);
    expect(within(panel).getByTestId('voice-staged-text')).not.toHaveTextContent('lights off');
  });
});

/**
 * Sara must answer in the language the visitor chose.  The controller's reason
 * is written in English by the firmware, and it used to be what she *spoke* —
 * so a Malayalam command was confirmed by an English sentence read out by a
 * Malayalam voice, which a visitor reported as "she answered in something
 * weird" (2026-11-17).
 */
describe('the language Sara answers in', () => {
  it('speaks the Malayalam confirmation, not the controller’s English reason', async () => {
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      pending_text: 'തെരുവ് വിളക്കുകൾ അണയ്ക്കുന്നു.',
      done_text: 'തെരുവ് വിളക്കുകൾ അണച്ചു.',
    } as never);
    vi.mocked(api.sendCommand).mockResolvedValue({
      confirmed: true,
      mode: 'demo',
      physical: false,
      ack: {
        result: 'ACCEPTED',
        reason_code: 'LIGHTS_MANUAL_OFF',
        // The device speaks English, whatever language the visitor chose.
        reason: 'Streetlights switched off manually.',
      },
      error: null,
    } as never);

    const speech = await import('../lib/speech');
    vi.mocked(speech.speakReply).mockClear();
    // Spoken replies on, or the panel says nothing at all.
    vi.mocked(api.settings).mockResolvedValue(makeSettings({ tts_enabled: true }));
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('button', { name: /മലയാളം/ }));
    await user.type(within(panel).getByTestId('voice-text'), 'ദയവായി ലൈറ്റുകൾ ഓഫ് ചെയ്യൂ');
    await user.click(within(panel).getByTestId('voice-send'));

    await waitFor(() =>
      expect(vi.mocked(speech.speakReply)).toHaveBeenCalledWith(
        'തെരുവ് വിളക്കുകൾ അണച്ചു.',
        'ml',
        'LIGHTS_OFF',
      ),
    );
    // And the English reason is not on screen beside the Malayalam answer.
    expect(screen.queryByTestId('voice-command-outcome')).not.toBeInTheDocument();
  });

  it('says a refusal in the visitor’s language, and shows the reason', async () => {
    vi.mocked(api.voiceInterpret).mockResolvedValue({
      status: 'ok',
      kind: 'command',
      intent: 'LIGHTS_OFF',
      command: 'LIGHTS_OFF',
      actuation: true,
      done_text: 'തെരുവ് വിളക്കുകൾ അണച്ചു.',
    } as never);
    vi.mocked(api.sendCommand).mockResolvedValue({
      confirmed: true,
      mode: 'live',
      physical: true,
      ack: {
        result: 'REJECTED',
        reason_code: 'LIGHTS_NOT_INSTALLED',
        reason: 'Streetlights are not installed in this build.',
      },
      error: null,
    } as never);

    const speech = await import('../lib/speech');
    vi.mocked(speech.speakReply).mockClear();
    // Spoken replies on, or the panel says nothing at all.  The catalogue
    // carries the refusal sentence, as the backend's own does.
    vi.mocked(api.settings).mockResolvedValue(makeSettings({ tts_enabled: true }));
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
      messages: {
        refused: {
          en: 'The village did not accept that. The reason is on the screen.',
          ml: 'ഗ്രാമം അത് സ്വീകരിച്ചില്ല. കാരണം സ്ക്രീനിൽ കാണാം.',
          hi: 'गाँव ने उसे स्वीकार नहीं किया। कारण स्क्रीन पर है।',
        },
      },
    } as never);
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('button', { name: /മലയാളം/ }));
    await user.type(within(panel).getByTestId('voice-text'), 'ദയവായി ലൈറ്റുകൾ ഓഫ് ചെയ്യൂ');
    await user.click(within(panel).getByTestId('voice-send'));

    await waitFor(() =>
      expect(vi.mocked(speech.speakReply)).toHaveBeenCalledWith(
        'ഗ്രാമം അത് സ്വീകരിച്ചില്ല. കാരണം സ്ക്രീനിൽ കാണാം.',
        'ml',
        'LIGHTS_OFF',
      ),
    );
    // The reason itself is still readable, in the controller's own words.
    expect(await screen.findByTestId('voice-command-outcome')).toHaveTextContent(
      /not installed/i,
    );
  });
});

/**
 * A language picked *while* Sara is listening must not re-read a sentence that
 * was already on its way (asked 2026-11-17).  The rule is the one a person would
 * expect: the request finishes in the language it started in.
 */
describe('a language change during a recording', () => {
  it('finishes the request in the language it began in', async () => {
    vi.mocked(api.voiceTranscribe).mockResolvedValue({
      status: 'unknown',
      kind: 'unknown',
      transcript: 'something',
      message: 'Not understood.',
    } as never);

    const { user, panel } = await openPanel();
    // English is the default, so the recording starts in English.
    await user.click(screen.getByTestId('voice-start'));

    // The visitor changes their mind mid-sentence.
    await user.click(within(panel).getByRole('button', { name: /മലയാളം/ }));

    // Pressing the same control stops the recording.
    await user.click(screen.getByTestId('voice-start'));

    await waitFor(() => expect(api.voiceTranscribe).toHaveBeenCalled());
    // The second argument is the language Whisper is told to expect.
    expect(vi.mocked(api.voiceTranscribe).mock.calls[0][1]).toBe('en');
  });

  it('uses the new language for the next request', async () => {
    vi.mocked(api.voiceTranscribe).mockResolvedValue({
      status: 'unknown',
      kind: 'unknown',
      transcript: 'എന്തോ',
      message: 'Not understood.',
    } as never);

    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('button', { name: /മലയാളം/ }));

    await user.click(screen.getByTestId('voice-start'));
    await user.click(screen.getByTestId('voice-start'));

    await waitFor(() => expect(api.voiceTranscribe).toHaveBeenCalled());
    expect(vi.mocked(api.voiceTranscribe).mock.calls[0][1]).toBe('ml');
  });
});

/**
 * "Your request" belongs to the sentence being spoken now (asked 2026-11-18).
 *
 * Leaving the previous command there while the visitor talks reads as "it
 * already heard me".  The reply is not touched: it answers the previous
 * question and is what the visitor was reading.
 */
describe('a new recording clears the request, not the reply', () => {
  it('empties "Your request" the moment Start is pressed', async () => {
    vi.mocked(api.voiceTranscribe).mockResolvedValue({
      status: 'status',
      kind: 'status',
      intent: 'WATER_STATUS',
      transcript: 'is water available?',
      response_text: 'The tank has water.',
    } as never);

    const { user } = await openPanel();
    // One complete request first.
    await user.click(screen.getByTestId('voice-start'));
    await user.click(screen.getByTestId('voice-start'));
    const request = await screen.findByTestId('voice-staged-text');
    await waitFor(() => expect(request).toHaveTextContent(/is water available/));
    // The reply to a status question is read from the frame on screen, so this
    // compares it rather than guessing its wording.
    const reply = screen.getByTestId('voice-reply-text').textContent;
    expect(reply).toBeTruthy();

    // Now start again: the request empties, the reply is untouched.
    await user.click(screen.getByTestId('voice-start'));
    expect(screen.getByTestId('voice-staged-text')).toHaveTextContent(/Listening/i);
    expect(screen.getByTestId('voice-reply-text').textContent).toBe(reply);
  });
});

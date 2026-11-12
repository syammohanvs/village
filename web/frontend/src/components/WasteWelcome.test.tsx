import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WasteWelcome } from './WasteWelcome';
import { LIA_COPY } from '../lib/lia';
import { VoiceUiProvider, useVoiceUi } from '../lib/voiceUi';

const speech = vi.hoisted(() => ({
  speakText: vi.fn(async (_text: string, _language: string, _rate?: number) => true),
  stopSpeaking: vi.fn(),
  speechSupported: vi.fn(() => true),
}));

vi.mock('../lib/speech', () => speech);

function renderWelcome() {
  return render(
    <VoiceUiProvider>
      <WasteWelcome />
    </VoiceUiProvider>,
  );
}

/** Choose a language the way a visitor does: press it, once, before landing. */
function setLanguage(code: 'en' | 'ml' | 'hi') {
  window.localStorage.setItem('village.voiceLanguage', code);
}

beforeEach(() => {
  speech.speakText.mockClear();
  speech.stopSpeaking.mockClear();
  speech.speakText.mockImplementation(async () => true);
  speech.speechSupported.mockReturnValue(true);
  setLanguage('en');
});

describe('Lia’s Sort Waste greeting', () => {
  it('says the line in the configured language as soon as the page opens', async () => {
    setLanguage('ml');
    renderWelcome();

    await waitFor(() => expect(speech.speakText).toHaveBeenCalledTimes(1));
    const [text, language] = speech.speakText.mock.calls[0];
    expect(language).toBe('ml');
    expect(text).toBe(LIA_COPY.ml.wasteWelcome);
    // The same words are on screen, so a silent device still gets the message.
    expect(screen.getByTestId('waste-welcome-line')).toHaveTextContent(LIA_COPY.ml.wasteWelcome);
  });

  it('asks an unsure visitor to show the item, and leaves the rest alone', async () => {
    renderWelcome();
    const line = screen.getByTestId('waste-welcome-line').textContent ?? '';

    // Both halves of the instruction the operator asked for.
    expect(line).toMatch(/know the bin/i);
    expect(line).toMatch(/go ahead/i);
    expect(line).toMatch(/not sure/i);
    expect(line).toMatch(/camera/i);

    // Short enough to be spoken while the page settles: two short sentences,
    // not a paragraph.
    expect(line.length).toBeLessThan(110);
    expect(screen.getByTestId('waste-welcome-line')).toBeInTheDocument();
  });

  it('speaks English for a visitor who never chose a language', async () => {
    window.localStorage.removeItem('village.voiceLanguage');
    renderWelcome();
    await waitFor(() => expect(speech.speakText).toHaveBeenCalledTimes(1));
    expect(speech.speakText.mock.calls[0][1]).toBe('en');
    expect(speech.speakText.mock.calls[0][0]).toBe(LIA_COPY.en.wasteWelcome);
  });

  it('has the greeting in every language the app offers', () => {
    for (const code of ['en', 'ml', 'hi'] as const) {
      const line = LIA_COPY[code].wasteWelcome;
      expect(line.trim().length).toBeGreaterThan(20);
      // A greeting left in English would be the bug this test exists for.
      if (code !== 'en') expect(line).not.toMatch(/know the bin/i);
    }
  });

  it('can be asked to say it again', async () => {
    renderWelcome();
    await waitFor(() => expect(speech.speakText).toHaveBeenCalledTimes(1));

    const again = screen.getByTestId('waste-welcome-replay');
    expect(again).toHaveTextContent('Hear it again');
    await userEvent.click(again);

    await waitFor(() => expect(speech.speakText).toHaveBeenCalledTimes(2));
    expect(speech.speakText.mock.calls[1][0]).toBe(LIA_COPY.en.wasteWelcome);
  });

  it('stops talking when it is dismissed, and does not come back', async () => {
    renderWelcome();
    await waitFor(() => expect(speech.speakText).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByTestId('waste-welcome-dismiss'));

    expect(speech.stopSpeaking).toHaveBeenCalled();
    expect(screen.queryByTestId('waste-welcome')).not.toBeInTheDocument();
    expect(speech.speakText).toHaveBeenCalledTimes(1);
  });

  it('says it in a language the visitor switches to while reading', async () => {
    // A harness because the switch lives on the provider: pressing a language in
    // the shell is what this simulates.  Re-reading localStorage mid-mount would
    // prove nothing — the provider reads it once, on purpose.
    function Harness() {
      const { setLanguage: choose } = useVoiceUi();
      return (
        <>
          <button type="button" onClick={() => choose('hi')}>
            Hindi
          </button>
          <WasteWelcome />
        </>
      );
    }
    render(
      <VoiceUiProvider>
        <Harness />
      </VoiceUiProvider>,
    );

    await waitFor(() => expect(speech.speakText).toHaveBeenCalledTimes(1));
    expect(speech.speakText.mock.calls[0][1]).toBe('en');

    await userEvent.click(screen.getByRole('button', { name: 'Hindi' }));

    await waitFor(() => expect(speech.speakText).toHaveBeenCalledTimes(2));
    expect(speech.speakText.mock.calls[1][1]).toBe('hi');
    expect(speech.speakText.mock.calls[1][0]).toBe(LIA_COPY.hi.wasteWelcome);
    // ...and the words on screen follow the voice.
    expect(screen.getByTestId('waste-welcome-line')).toHaveTextContent(LIA_COPY.hi.wasteWelcome);
  });

  it('shows the words and offers the button when the device stays silent', async () => {
    speech.speakText.mockImplementation(async () => false);
    renderWelcome();

    const note = await screen.findByTestId('waste-welcome-note');
    expect(note).toHaveTextContent(/hear it again/i);
    // The instruction is still readable, which is the whole point of showing it.
    expect(screen.getByTestId('waste-welcome-line')).toHaveTextContent(LIA_COPY.en.wasteWelcome);
  });

  it('names a browser with no speech support instead of pretending', async () => {
    speech.speechSupported.mockReturnValue(false);
    speech.speakText.mockImplementation(async () => false);
    renderWelcome();

    const note = await screen.findByTestId('waste-welcome-note');
    expect(note).toHaveTextContent(LIA_COPY.en.speechUnavailable);
  });
});

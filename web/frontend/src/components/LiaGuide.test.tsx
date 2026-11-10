import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiaGuide } from './LiaGuide';
import { LIA_STORAGE_KEY } from '../lib/lia';
import { openLia } from '../lib/liaUi';
import { VoiceUiProvider } from '../lib/voiceUi';
import { makeState } from '../test/fixtures';

const village = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('../lib/village', () => ({ useVillage: () => village.current }));

const speech = vi.hoisted(() => ({
  speakText: vi.fn(async (_text: string, _language: string, _rate?: number) => true),
  primeVoices: vi.fn(async () => []),
  stopSpeaking: vi.fn(),
  speechSupported: vi.fn(() => true),
  voiceAvailable: vi.fn(() => true),
}));

vi.mock('../lib/speech', () => speech);

function renderGuide() {
  return render(
    <MemoryRouter>
      <VoiceUiProvider>
        <LiaGuide />
      </VoiceUiProvider>
    </MemoryRouter>,
  );
}

function openGuide(entry: 'help' | 'model' | 'voice' | 'events' = 'help') {
  act(() => openLia(entry));
}

function setVillage(overrides: Record<string, unknown> = {}) {
  village.current = {
    status: makeState().status,
    connected: true,
    stale: false,
    ageMs: 400,
    demo: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  speech.speechSupported.mockReturnValue(true);
  speech.voiceAvailable.mockReturnValue(true);
  setVillage();
});

describe('Lia guide', () => {
  it('stays closed until asked, then offers three quick choices and every topic', async () => {
    renderGuide();
    expect(screen.queryByTestId('lia-guide')).not.toBeInTheDocument();

    openGuide();
    expect(screen.getByTestId('lia-guide')).toBeInTheDocument();
    expect(screen.getByText(/Hello! I’m Lia. I can help you explore our village/)).toBeInTheDocument();

    expect(screen.getByTestId('lia-quick-model')).toHaveTextContent('Show me the model');
    expect(screen.getByTestId('lia-quick-voice')).toHaveTextContent('Help me use voice');
    expect(screen.getByTestId('lia-quick-events')).toHaveTextContent('Explain what happened');

    // The duplicate "Show me the model" entry is gone; the model is the first
    // quick choice.  The longer list stays folded until it is asked for.
    expect(screen.queryByTestId('lia-topic-around')).not.toBeInTheDocument();
    expect(screen.getByText('More help topics')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('More help topics'));
    for (const id of ['water', 'lights', 'waste', 'voice', 'help']) {
      expect(screen.getByTestId(`lia-topic-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Maybe later' })).toBeInTheDocument();
    expect(screen.getByTestId('lia-read-aloud')).toBeInTheDocument();
  });

  it('disables read-aloud with an explanation when the language voice is missing', async () => {
    speech.voiceAvailable.mockReturnValue(false);
    renderGuide();
    openGuide();
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('lia-read-aloud')).toBeDisabled();
    expect(screen.getByText(/no .* voice/i)).toBeInTheDocument();
  });

  it('switches to Malayalam without losing the structure', async () => {
    const user = userEvent.setup();
    renderGuide();
    openGuide();

    await user.click(screen.getByTestId('lia-lang-ml'));
    expect(screen.getByText(/ഹലോ!/)).toBeInTheDocument();
    expect(screen.getByTestId('lia-topic-water')).toHaveTextContent('ചെടികൾക്ക് വെള്ളം നൽകൂ');
    expect(screen.getByRole('button', { name: 'പിന്നീട്' })).toBeInTheDocument();
  });

  it('remembers a dismissal and reopens from the shared entry point', async () => {
    const user = userEvent.setup();
    renderGuide();
    openGuide();

    await user.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(screen.queryByTestId('lia-guide')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(LIA_STORAGE_KEY) ?? '{}').dismissed).toBe(true);

    openGuide();
    expect(screen.getByTestId('lia-guide')).toBeInTheDocument();
  });

  it('closes with Escape without leaving a floating button behind', async () => {
    const user = userEvent.setup();
    renderGuide();
    openGuide();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('lia-guide')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lia-fab')).not.toBeInTheDocument();
  });

  it('walks a topic step by step and shows the adult demonstration once', async () => {
    const user = userEvent.setup();
    renderGuide();
    openGuide();

    await user.click(screen.getByTestId('lia-topic-water'));
    expect(screen.getByText('Check the soil')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Check the tank')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('It stops by itself')).toBeInTheDocument();
    expect(screen.getByText(/put the soil probe in dry soil/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to topics' })).toBeInTheDocument();
  });

  it('starts reading as soon as it opens, in the chosen language', async () => {
    renderGuide();
    openGuide();

    // No second press: opening Lia is the invitation, and at the exhibition a
    // visitor should hear her immediately.
    await waitFor(() => expect(speech.speakText).toHaveBeenCalledTimes(1));
    expect(speech.speakText.mock.calls[0][0]).toContain('Hello! I’m Lia');
    expect(speech.speakText.mock.calls[0][1]).toBe('en');
    expect(screen.getByTestId('lia-read-aloud')).toHaveAttribute('aria-pressed', 'true');
  });

  it('stops when pressed, and reads again when pressed a second time', async () => {
    const user = userEvent.setup();
    renderGuide();
    openGuide();
    await waitFor(() => expect(speech.speakText).toHaveBeenCalledTimes(1));

    await user.click(screen.getByTestId('lia-read-aloud'));
    expect(speech.stopSpeaking).toHaveBeenCalled();
    expect(screen.getByTestId('lia-read-aloud')).toHaveAttribute('aria-pressed', 'false');

    const before = speech.speakText.mock.calls.length;
    await user.click(screen.getByTestId('lia-read-aloud'));
    await waitFor(() => expect(speech.speakText.mock.calls.length).toBeGreaterThan(before));
    expect(screen.getByTestId('lia-read-aloud')).toHaveAttribute('aria-pressed', 'true');
  });

  it('stays silent on open when the preference says so', async () => {
    window.localStorage.setItem(LIA_STORAGE_KEY, JSON.stringify({ autoRead: false }));
    renderGuide();
    openGuide();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(speech.speakText).not.toHaveBeenCalled();
    expect(screen.getByTestId('lia-read-aloud')).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens the live explanation from the quick choice and keeps volume claims out', async () => {
    const user = userEvent.setup();
    renderGuide();
    openGuide();

    await user.click(screen.getByTestId('lia-quick-events'));
    expect(screen.getByText(/The soil is dry \(28%\)/)).toBeInTheDocument();
    expect(screen.getByText(/There is water at the low level/)).toBeInTheDocument();
    expect(screen.queryByText(/litre|liter/i)).not.toBeInTheDocument();
  });

  it('says a probe is uncalibrated instead of inventing a percentage', async () => {
    setVillage({
      status: makeState({
        soilState: 'uncalibrated',
        soilCalibrated: false,
        soilPercent: null,
        reservoirState: 'uncalibrated',
      }).status,
    });
    const user = userEvent.setup();
    renderGuide();
    openGuide();

    await user.click(screen.getByTestId('lia-quick-events'));
    expect(screen.getByText(/soil probe is not calibrated/)).toBeInTheDocument();
    expect(screen.getByText(/tank probes are not calibrated/)).toBeInTheDocument();
    expect(screen.queryByText(/soil is dry \(28%\)/)).not.toBeInTheDocument();
  });

  it('explains an offline village and does not show sensor claims', async () => {
    setVillage({ status: null, connected: false });
    const user = userEvent.setup();
    renderGuide();
    openGuide();

    await user.click(screen.getByTestId('lia-quick-events'));
    expect(screen.getByText(/The village is offline/)).toBeInTheDocument();
    expect(screen.getByText(/check the power and Wi-Fi/)).toBeInTheDocument();
    expect(screen.queryByText(/soil is dry/)).not.toBeInTheDocument();
  });
});

describe('read-aloud follows the language', () => {
  it('reads the same view in Malayalam when the language changes with read-aloud on', async () => {
    const user = userEvent.setup();
    renderGuide();
    openGuide();

    await waitFor(() => expect(speech.speakText).toHaveBeenCalledTimes(1));
    expect(speech.speakText.mock.calls[0][1]).toBe('en');

    await user.click(screen.getByTestId('lia-lang-ml'));

    await waitFor(() => expect(speech.speakText).toHaveBeenCalledTimes(2));
    expect(speech.speakText.mock.calls[1][1]).toBe('ml');
    expect(String(speech.speakText.mock.calls[1][0])).toMatch(/ഹലോ|ലിയ/);
    // The button stays ON: it must not need a second press (which would turn
    // read-aloud off).
    expect(screen.getByTestId('lia-read-aloud')).toHaveAttribute('aria-pressed', 'true');
  });
});

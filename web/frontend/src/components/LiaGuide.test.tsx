import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiaGuide } from './LiaGuide';
import { LIA_STORAGE_KEY } from '../lib/lia';
import { VoiceUiProvider } from '../lib/voiceUi';
import { makeState } from '../test/fixtures';

const village = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('../lib/village', () => ({ useVillage: () => village.current }));

const speech = vi.hoisted(() => ({
  speakText: vi.fn(async (_text: string, _language: string, _rate?: number) => undefined),
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
  speech.speechSupported.mockReturnValue(true);
  speech.voiceAvailable.mockReturnValue(true);
  setVillage();
});

describe('Lia guide', () => {
  it('welcomes a first-time visitor with the six large choices', () => {
    renderGuide();
    expect(screen.getByTestId('lia-guide')).toBeInTheDocument();
    expect(screen.getByText(/Hello! I’m Lia, your village helper/)).toBeInTheDocument();
    for (const id of ['around', 'water', 'lights', 'waste', 'voice', 'help']) {
      expect(screen.getByTestId(`lia-topic-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Maybe later' })).toBeInTheDocument();
    expect(screen.getByTestId('lia-read-aloud')).toBeInTheDocument();
  });

  it('switches to Malayalam without losing the structure', async () => {
    const user = userEvent.setup();
    renderGuide();
    await user.click(screen.getByTestId('lia-lang-ml'));
    expect(screen.getByText(/ഹലോ!/)).toBeInTheDocument();
    expect(screen.getByTestId('lia-topic-water')).toHaveTextContent('ചെടികൾക്ക് വെള്ളം നൽകൂ');
    expect(screen.getByRole('button', { name: 'പിന്നീട്' })).toBeInTheDocument();
  });

  it('remembers a dismissal and keeps the helper button everywhere', async () => {
    const user = userEvent.setup();
    renderGuide();

    await user.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(screen.queryByTestId('lia-guide')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(LIA_STORAGE_KEY) ?? '{}').dismissed).toBe(true);

    const fab = screen.getByTestId('lia-fab');
    expect(fab).toHaveAccessibleName('Help with Lia');
    await user.click(fab);
    expect(screen.getByTestId('lia-guide')).toBeInTheDocument();
  });

  it('closes with Escape and leaves the helper button in place', async () => {
    const user = userEvent.setup();
    renderGuide();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('lia-guide')).not.toBeInTheDocument();
    expect(screen.getByTestId('lia-fab')).toBeInTheDocument();
  });

  it('walks a topic step by step and shows the adult demonstration', async () => {
    const user = userEvent.setup();
    renderGuide();

    await user.click(screen.getByTestId('lia-topic-water'));
    expect(screen.getByText('Check the soil')).toBeInTheDocument();
    expect(screen.getByText(/Ask a grown-up to help/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Check the tank')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('It stops by itself')).toBeInTheDocument();
    expect(screen.getByText(/put the soil probe in dry soil/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to topics' })).toBeInTheDocument();
  });

  it('reads the welcome aloud and follows a language change', async () => {
    const user = userEvent.setup();
    renderGuide();

    await user.click(screen.getByTestId('lia-read-aloud'));
    await waitFor(() => expect(speech.speakText).toHaveBeenCalled());
    expect(speech.speakText.mock.calls.at(-1)?.[0]).toContain('Hello! I’m Lia');
    expect(speech.speakText.mock.calls.at(-1)?.[1]).toBe('en');

    await user.click(screen.getByTestId('lia-lang-hi'));
    await waitFor(() =>
      expect(speech.speakText.mock.calls.some((call) => call[1] === 'hi')).toBe(true),
    );
    expect(speech.speakText.mock.calls.at(-1)?.[0]).toContain('नमस्ते');
  });

  it('narrates live values and keeps volume claims out', async () => {
    const user = userEvent.setup();
    renderGuide();

    await user.click(screen.getByRole('button', { name: 'What is happening now?' }));
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

    await user.click(screen.getByRole('button', { name: 'What is happening now?' }));
    expect(screen.getByText(/soil probe is not calibrated/)).toBeInTheDocument();
    expect(screen.getByText(/tank probes are not calibrated/)).toBeInTheDocument();
    expect(screen.queryByText(/soil is dry \(28%\)/)).not.toBeInTheDocument();
  });

  it('explains an offline village and does not show sensor claims', async () => {
    setVillage({ status: null, connected: false });
    const user = userEvent.setup();
    renderGuide();

    await user.click(screen.getByRole('button', { name: 'What is happening now?' }));
    expect(screen.getByText(/The village is offline/)).toBeInTheDocument();
    expect(screen.getByText(/check the power and Wi-Fi/)).toBeInTheDocument();
    expect(screen.queryByText(/soil is dry/)).not.toBeInTheDocument();
  });
});

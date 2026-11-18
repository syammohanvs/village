import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../lib/api';
import { makeState } from '../test/fixtures';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      state: vi.fn(),
      sendCommand: vi.fn(),
      events: vi.fn(),
      settings: vi.fn(),
      wasteModelStatus: vi.fn(),
      voiceReadiness: vi.fn(),
      voiceIntents: vi.fn(),
      session: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
    },
  };
});

const accepted = {
  confirmed: true,
  mode: 'live' as const,
  physical: true,
  error: null,
  ack: { result: 'ACCEPTED', reason_code: 'OK', reason: 'Accepted.' },
};

beforeEach(() => {
  vi.mocked(api.session).mockResolvedValue({
    authenticated: true,
    username: 'admin',
    auth_enabled: true,
  });
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.events).mockResolvedValue({ events: [] });
  vi.mocked(api.settings).mockResolvedValue({} as never);
  vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true });
  vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: false });
  vi.mocked(api.voiceIntents).mockResolvedValue({ languages: [], intents: [] });
  vi.mocked(api.sendCommand).mockResolvedValue(accepted as never);
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

/** Render the exhibit and wait for the first frame (the gate adds a round trip). */
async function renderExhibit() {
  render(<App />);
  await waitFor(() => {
    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/Checking the session/i);
    expect(page).not.toMatch(/Waiting for the first frame/i);
  });
}

describe('the single-page exhibit', () => {
  it('is one page with the mark and the name in the header, and no side menu', async () => {
    await renderExhibit();

    expect(screen.getByText('Smart Green Village')).toBeInTheDocument();
    // The menu is what invited a visitor into Setup; the exhibit does not draw
    // one at all.
    expect(document.querySelector('.sidebar')).toBeNull();
    expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument();

    // Connection state is still reported exactly once, in the header.
    expect(screen.getByTestId('connection-pill')).toBeInTheDocument();

    // Three stops, one checked, Live the default.
    const stops = screen.getAllByRole('radio');
    expect(stops).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Live' })).toHaveAttribute('aria-checked', 'true');
  });

  it('signs out from the header, which is where the account control went', async () => {
    const user = userEvent.setup();
    vi.mocked(api.logout).mockResolvedValue({ authenticated: false });
    await renderExhibit();

    await user.click(screen.getByTestId('sign-out'));
    expect(api.logout).toHaveBeenCalled();
    expect(await screen.findByTestId('login-form')).toBeInTheDocument();
  });

  it('Simulation is invented readings and Live goes back to the controller', async () => {
    const user = userEvent.setup();
    await renderExhibit();

    await user.click(screen.getByRole('radio', { name: 'Simulation' }));
    expect(window.localStorage.getItem('village.demoMode')).toBe('demo');
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Simulation');

    await user.click(screen.getByRole('radio', { name: 'Live' }));
    expect(window.localStorage.getItem('village.demoMode')).toBe('live');
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Live');
  });

  it('a shared link opens in Simulation with Live and Test locked', async () => {
    // The link signs in as the guest, and the guest is a look at the village:
    // whatever this browser remembered, it may not open in Live.
    window.localStorage.setItem('village.demoMode', 'live');
    vi.mocked(api.session).mockResolvedValue({
      authenticated: true,
      username: 'guest',
      auth_enabled: true,
      guest: true,
    });
    const user = userEvent.setup();
    await renderExhibit();

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Simulation' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Simulation');

    const live = screen.getByRole('radio', { name: 'Live' });
    const test = screen.getByRole('radio', { name: 'Test' });
    expect(live).toBeDisabled();
    expect(test).toBeDisabled();
    expect(live).toHaveAttribute('title', expect.stringMatching(/shared link/i));

    // Pressing one does nothing at all — the page is not merely painted over.
    await user.click(live);
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Simulation');
    expect(screen.queryByTestId('test-dialog')).not.toBeInTheDocument();
  });

  it('a link asking for Simulation opens in it, and leaves the address clean', async () => {
    // This is what `/api/v1/auth/magic` redirects to.  The mode is read once
    // and taken out of the URL so a refresh does not re-apply it.
    window.history.pushState({}, '', '/?mode=demo');
    await renderExhibit();

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Simulation' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(window.localStorage.getItem('village.demoMode')).toBe('demo');
    expect(window.location.search).toBe('');
    // An ordinary visit still has every stop.
    expect(screen.getByRole('radio', { name: 'Live' })).toBeEnabled();
  });

  it('refuses Test while the controller is away, and says why', async () => {
    const user = userEvent.setup();
    vi.mocked(api.state).mockResolvedValue(makeState({ connected: false }));
    await renderExhibit();

    const test = screen.getByRole('radio', { name: 'Test' });
    expect(test).toBeDisabled();
    expect(screen.getByTestId('mode-note')).toHaveTextContent(/connect the controller/i);

    await user.click(test);
    // A panel of switches that could only be refused is worse than no panel.
    expect(screen.queryByTestId('test-dialog')).not.toBeInTheDocument();
  });

  it('the bench panel takes the outputs, drives them, and gives them back', async () => {
    const user = userEvent.setup();
    vi.mocked(api.state).mockResolvedValue(makeState({ testEnabled: true }));
    await renderExhibit();

    await user.click(screen.getByRole('radio', { name: 'Test' }));

    expect(await screen.findByTestId('test-dialog')).toBeInTheDocument();
    // Opening the panel *is* test mode.
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TEST_MODE', parameters: { on: true } }),
    );

    await user.click(screen.getByRole('switch', { name: 'Pump / motor (D19)' }));
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TEST_OUTPUT',
        parameters: { output: 'pump', on: true },
      }),
    );

    await user.click(screen.getByTestId('test-done'));

    // Closing is the way out: the panel goes, the outputs are released, and the
    // knob returns to Live.
    await waitFor(() => expect(screen.queryByTestId('test-dialog')).not.toBeInTheDocument());
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TEST_MODE', parameters: { on: false } }),
    );
    expect(screen.getByRole('radio', { name: 'Live' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Escape closes the bench panel the same way Done does', async () => {
    const user = userEvent.setup();
    vi.mocked(api.state).mockResolvedValue(makeState({ testEnabled: true }));
    await renderExhibit();

    await user.click(screen.getByRole('radio', { name: 'Test' }));
    await screen.findByTestId('test-dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByTestId('test-dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('radio', { name: 'Live' })).toHaveAttribute('aria-checked', 'true');
  });

  it('says so when the controller did not confirm the outputs were released', async () => {
    const user = userEvent.setup();
    vi.mocked(api.state).mockResolvedValue(makeState({ testEnabled: true }));
    vi.mocked(api.sendCommand).mockImplementation(async (body) => {
      if (body.type === 'TEST_MODE' && (body.parameters as { on?: boolean }).on === false) {
        return {
          confirmed: false,
          mode: 'live',
          physical: true,
          error: { code: 'TIMEOUT', message: 'the controller did not answer' },
        } as never;
      }
      return accepted as never;
    });
    await renderExhibit();

    await user.click(screen.getByRole('radio', { name: 'Test' }));
    await screen.findByTestId('test-dialog');
    await user.click(screen.getByTestId('test-done'));

    expect(await screen.findByTestId('mode-warning')).toHaveTextContent(/may still be held/i);
  });

  it('opens the waste sorter over the village, and Done comes back to it', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/waste');
    await renderExhibit();

    expect(await screen.findByTestId('waste-dialog')).toBeInTheDocument();
    // The village page is still behind the panel, so its readings never blink.
    expect(screen.getByTestId('card-plants')).toBeInTheDocument();

    await user.click(screen.getByTestId('waste-done'));

    await waitFor(() => expect(screen.queryByTestId('waste-dialog')).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('card-plants')).toBeInTheDocument();
  });
});

describe('the mode knob says what the stop means', () => {
  it('says Simulation does not control the physical model', async () => {
    const user = userEvent.setup();
    await renderExhibit();

    await user.click(screen.getByRole('radio', { name: 'Simulation' }));
    expect(screen.getByTestId('mode-note')).toHaveTextContent(
      'Simulation — physical model is not controlled.',
    );

    await user.click(screen.getByRole('radio', { name: 'Live' }));
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Live');
    // The sentence belongs to Simulation; Live says nothing extra.
    expect(screen.queryByTestId('mode-note')).not.toBeInTheDocument();
  });
});

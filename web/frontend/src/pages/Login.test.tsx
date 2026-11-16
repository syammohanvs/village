import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { ApiError, api } from '../lib/api';
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
      wasteModelStatus: vi.fn(),
      voiceReadiness: vi.fn(),
      voiceIntents: vi.fn(),
      settings: vi.fn(),
      session: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
    },
  };
});

beforeEach(() => {
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.events).mockResolvedValue({ events: [] });
  vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true });
  vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: false });
  vi.mocked(api.voiceIntents).mockResolvedValue({ languages: [], intents: [] });
  vi.mocked(api.settings).mockResolvedValue({} as never);
  vi.mocked(api.logout).mockResolvedValue({ authenticated: false });
  window.history.pushState({}, '', '/');
});

/**
 * The gate, and the one form in front of it.
 *
 * Pinned here because the failure this file exists to prevent is the quiet one:
 * a visitor on a screen nobody is watching pressing **Water** or walking into
 * **Setup**.  So the assertion is not "a form appears" but "the village is not
 * mounted behind it".
 */
describe('the sign-in gate', () => {
  it('shows the form and mounts nothing of the village when nobody is signed in', async () => {
    vi.mocked(api.session).mockResolvedValue({
      authenticated: false,
      username: null,
      auth_enabled: true,
    });
    render(<App />);

    expect(await screen.findByTestId('login-form')).toBeInTheDocument();
    // Not merely hidden: the dashboard was never mounted, so no page can be
    // reached and no button pressed behind the card.
    expect(screen.queryByText('Watering')).not.toBeInTheDocument();
    expect(screen.queryByTestId('water-plants')).not.toBeInTheDocument();
    // The board keeps running; only the screen is locked.
    expect(screen.queryByTestId('connection-pill')).not.toBeInTheDocument();
  });

  it('goes straight in when the deployment has the gate switched off', async () => {
    vi.mocked(api.session).mockResolvedValue({
      authenticated: true,
      username: null,
      auth_enabled: false,
    });
    render(<App />);

    expect(await screen.findByTestId('connection-pill')).toBeInTheDocument();
    expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();
    // No sign-out row, because there is no session to end.
    expect(screen.queryByTestId('sign-out')).not.toBeInTheDocument();
  });

  it('says a wrong password was wrong, and keeps the form usable', async () => {
    vi.mocked(api.session).mockResolvedValue({
      authenticated: false,
      username: null,
      auth_enabled: true,
    });
    vi.mocked(api.login).mockRejectedValue(
      new ApiError(401, 'that username and password do not match'),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByTestId('login-username'), 'admin');
    await user.type(screen.getByTestId('login-password'), 'wrong');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('login-error')).toHaveTextContent(
      /username and password do not match/i,
    );
    // The username stays (it was probably right) and the password does not.
    expect(screen.getByTestId('login-username')).toHaveValue('admin');
    expect(screen.getByTestId('login-password')).toHaveValue('');
    // Trying again is one keystroke away: the username is kept, and the button
    // comes back as soon as a password is typed.
    await user.type(screen.getByTestId('login-password'), 'village');
    expect(screen.getByTestId('login-submit')).toBeEnabled();
  });

  it('signs in and then shows the dashboard, with a way back out', async () => {
    vi.mocked(api.session).mockResolvedValue({
      authenticated: false,
      username: null,
      auth_enabled: true,
    });
    vi.mocked(api.login).mockResolvedValue({ authenticated: true, username: 'admin' });
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByTestId('login-username'), 'admin');
    await user.type(screen.getByTestId('login-password'), 'village');
    await user.click(screen.getByTestId('login-submit'));

    // The form goes and the village arrives.
    await waitFor(() => expect(screen.queryByTestId('login-form')).not.toBeInTheDocument());
    expect(await screen.findByTestId('connection-pill')).toBeInTheDocument();
    expect(await screen.findByText('Watering')).toBeInTheDocument();

    // Signing out returns to the form and ends the session on the server.
    await user.click(screen.getByTestId('sign-out'));
    expect(await screen.findByTestId('login-form')).toBeInTheDocument();
    expect(api.logout).toHaveBeenCalled();

    expect(vi.mocked(api.login).mock.calls[0]).toEqual(['admin', 'village']);
  });

  it('offers a retry when the backend cannot be asked, rather than guessing', async () => {
    vi.mocked(api.session).mockRejectedValueOnce(new ApiError(0, 'cannot reach the service', { code: 'NETWORK' }));
    render(<App />);

    const card = await screen.findByTestId('session-error');
    expect(card).toHaveTextContent(/did not answer/i);
    // A failed check is not "you are not allowed in", so no password is asked for.
    expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();

    vi.mocked(api.session).mockResolvedValue({
      authenticated: true,
      username: null,
      auth_enabled: false,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByTestId('connection-pill')).toBeInTheDocument();
  });

  it('returns to the form when a request anywhere comes back 401', async () => {
    vi.mocked(api.session).mockResolvedValue({
      authenticated: true,
      username: 'admin',
      auth_enabled: true,
    });
    render(<App />);
    expect(await screen.findByTestId('connection-pill')).toBeInTheDocument();

    // The cookie expired while the page was open: any 401 raises this event.
    window.dispatchEvent(new Event('village:unauthorised'));

    expect(await screen.findByTestId('login-form')).toBeInTheDocument();
    expect(screen.queryByTestId('connection-pill')).not.toBeInTheDocument();
  });
});

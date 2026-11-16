import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    },
  };
});

beforeEach(() => {
  window.history.pushState({}, '', '/');
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.events).mockResolvedValue({ events: [] });
  vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true });
  vi.mocked(api.sendCommand).mockResolvedValue({
    confirmed: true,
    mode: 'live',
    physical: true,
    ack: { result: 'ACCEPTED', reason_code: 'ACCEPTED', reason: 'The controller accepted the command.' },
    error: null,
  });
});

afterEach(() => {
  window.localStorage.removeItem('village.demoMode');
  window.history.pushState({}, '', '/');
});

describe('Our Village', () => {
  it('shows the six everyday cards with honest values', async () => {
    render(<App />);

    expect(await screen.findByText('Watering')).toBeInTheDocument();
    expect(screen.getByText('Tank')).toBeInTheDocument();
    expect(screen.getByText('Lights')).toBeInTheDocument();
    expect(screen.getByText('Waste')).toBeInTheDocument();
    expect(screen.getByText('Solar')).toBeInTheDocument();
    expect(screen.getByText('Wind')).toBeInTheDocument();

    expect(screen.getByText(/28%/)).toBeInTheDocument();
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    // The Lights card carries the sensor reading as a chip, not a sentence.
    expect(within(screen.getByTestId('card-lights')).getByText('Dark')).toBeInTheDocument();
    // Nothing on this page claims to know how full a bin is.
    expect(screen.queryByText(/distance sensor/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/full/i)).not.toBeInTheDocument();

    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/\d+(?:\.\d+)?\s*(?:l|litres?|liters?)\b/i);
    expect(body).not.toMatch(/energy saved/i);
    expect(body).not.toMatch(/solar output/i);
    expect(body).not.toMatch(/water used/i);
  });

  it('never invents a light level when no LDR is fitted', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ lightInstalled: false, lightBrightness: 'unknown' }),
    );
    render(<App />);

    const card = within(await screen.findByTestId('card-lights'));
    expect(card.getByText('No sensor')).toBeInTheDocument();
    expect(card.queryByText('Dark')).not.toBeInTheDocument();
    expect(card.queryByText('Bright')).not.toBeInTheDocument();
  });

  it('explains why watering is disabled when the tank is low', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ reservoirState: 'low' }));
    render(<App />);

    expect(await screen.findByText(/Refill the reservoir before watering/i)).toBeInTheDocument();
    expect(screen.getByTestId('water-plants')).toBeDisabled();
  });

  it('says when the frame is stale', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ stale: true, ageMs: 7200 }));
    render(<App />);

    expect(await screen.findByTestId('stale-banner')).toHaveTextContent(/not live/i);
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Stale');
  });

  it('shows the last frame time while live instead of a flickering millisecond count', async () => {
    render(<App />);

    const pill = await screen.findByTestId('connection-pill');
    expect(pill).toHaveTextContent('Live');
    // The backend polls once a second, so a relative "N ms ago" swung between
    // 0 and 1000 and read as a frozen counter.  A clock of the last frame is
    // both honest and visibly moving.
    expect(pill.textContent ?? '').toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(pill.textContent ?? '').not.toMatch(/\d+\s*ms ago/);
    expect(pill.getAttribute('title') ?? '').toMatch(/Last frame/i);
  });

  it('keeps the cards visible and disables actions when the controller is offline', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ connected: false, stale: false, ageMs: 15000, lastError: 'Timed out contacting the controller.' }),
    );
    render(<App />);

    expect(await screen.findByTestId('offline-banner')).toHaveTextContent(/controller offline/i);
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Offline');
    expect(screen.getByText('Watering')).toBeInTheDocument();
    expect(screen.getByTestId('water-plants')).toBeDisabled();
    expect(screen.getByTestId('lights-auto')).toBeDisabled();
    // The shell's banner says the controller is offline once; the page itself
    // does not repeat it.
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();
  });

  it('labels simulation and sends demo commands for Water Plants', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByTestId('demo-banner')).toHaveTextContent(
      /the physical board will not respond/i,
    );
    // The pill must not claim the board is live while every number is invented.
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Simulation');
    expect(screen.getByTestId('connection-pill')).not.toHaveTextContent('Live');

    const start = await screen.findByTestId('water-plants');
    expect(start).toBeEnabled();
    await user.click(start);

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalled());
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'IRRIGATION_REQUEST', mode: 'demo' }),
    );
  });

  it('leaves simulation in one press from the banner', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByTestId('back-to-live'));

    await waitFor(() => expect(window.localStorage.getItem('village.demoMode')).toBe('live'));
    await waitFor(() => expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument());
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Live');
  });

  it('keeps Stop reachable and reports an unconfirmed result', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ watering: true }));
    vi.mocked(api.sendCommand).mockRejectedValue(
      new ApiError(503, 'The controller did not acknowledge the command.', {
        code: 'DEVICE_UNREACHABLE',
        confirmed: false,
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    const stop = await screen.findByTestId('stop-watering');
    expect(stop).toHaveTextContent('Stop');
    await user.click(stop);

    await waitFor(() =>
      expect(api.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'IRRIGATION_STOP' }),
      ),
    );
    // The card says the controller did not confirm, rather than claiming success.
    expect(
      await screen.findByText('The controller did not acknowledge the command.'),
    ).toBeInTheDocument();
  });
});

describe('solar pill', () => {
  it('stays neutral while the panel reads volts but no current flows', async () => {
    // A dark panel: 142 mV, no current.  That is a true reading, not a fault, and
    // a green "live" pill here would claim the panel is producing power.
    render(<App />);
    const card = within(await screen.findByTestId('card-solar'));
    const chip = card.getByText('Not generating');
    expect(chip).toHaveClass('chip', 'chip--neutral');
    expect(chip).not.toHaveClass('chip--live');
    expect(card.getByText(/0.14 V · 0.00 mA · 0.0 mW/)).toBeInTheDocument();
    expect(card.queryByText(/milliwatts/i)).not.toBeInTheDocument();
  });

  it('goes green only once the panel is actually making power', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ solarMillivolts: 3200, solarCurrentMa: 4.55, solarPowerMw: 14.6 }),
    );
    render(<App />);
    const card = within(await screen.findByTestId('card-solar'));
    const chip = card.getByText('Generating');
    expect(chip).toHaveClass('chip--live');
    expect(card.getByText(/3\.20 V · 4\.55 mA · 14\.6 mW/)).toBeInTheDocument();
  });

  it('says where the two taps go when there is no reading at all', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ solarMillivolts: null }));
    render(<App />);
    const card = within(await screen.findByTestId('card-solar'));
    expect(card.getAllByText('No reading').length).toBeGreaterThan(0);
    expect(card.queryByText(/GPIO/i)).not.toBeInTheDocument();
  });
});

describe('unknown readings', () => {
  it('never claims Idle, Off or "not commissioned" without a frame', async () => {
    vi.mocked(api.state).mockRejectedValue(new Error('backend down'));
    render(<App />);

    expect(await screen.findByText(/village service is not answering/i)).toBeInTheDocument();
    expect(screen.getAllByText('Status unknown').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Idle$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/not commissioned/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Connect the board to check watering readiness/i)).toBeInTheDocument();

    for (const mode of ['auto', 'on', 'off'] as const) {
      expect(screen.getByTestId(`lights-${mode}`)).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

describe('Watering — starting and stopping are different permissions', () => {
  it('offers neither button while nothing can run or is running', async () => {
    // The user's rule (2026-11-16): Stop appears only while the pump is on, so a
    // card that says watering is not needed does not also offer a button that
    // looks like it would do something.
    vi.mocked(api.state).mockResolvedValue(makeState({ soilCalibrated: false }));
    render(<App />);

    const card = within(await screen.findByTestId('card-plants'));
    expect(card.getByText(/Not calibrated/i)).toBeInTheDocument();
    expect(card.getByTestId('water-plants')).toBeDisabled();
    expect(card.getByTestId('stop-watering')).toBeDisabled();
  });

  it('disables Stop when the controller cannot be reached', async () => {
    // Offered while unreachable, a press can only fail -- that was the
    // inconsistency: a live Stop beside a disabled Water.
    vi.mocked(api.state).mockResolvedValue(makeState({ connected: false }));
    render(<App />);

    const card = within(await screen.findByTestId('card-plants'));
    expect(card.getByTestId('stop-watering')).toBeDisabled();
  });

  it('keeps Stop offered while the pump is running', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ watering: true }));
    render(<App />);

    const card = within(await screen.findByTestId('card-plants'));
    const stop = card.getByTestId('stop-watering');
    expect(stop).toBeEnabled();
    expect(stop).toHaveAttribute('title', 'Stop the pump now.');
  });
});

describe('Our Village — the microphone stands alone', () => {
  it('centres the microphone with the language choices under it', async () => {
    render(<App />);
    const mic = await screen.findByTestId('start-voice');
    const languages = await screen.findByRole('group', { name: 'Language' });

    // Both live in the one header, and the language choices follow the
    // microphone -- the layout is a column, so that is "below".
    const header = mic.closest('.village-simple-top');
    expect(header).not.toBeNull();
    expect(header).toContainElement(languages);
    expect(mic.compareDocumentPosition(languages) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(languages).toHaveClass('village-simple-langs');
  });

  it('still offers all three spoken languages under the microphone', async () => {
    render(<App />);
    const languages = await screen.findByRole('group', { name: 'Language' });
    for (const code of ['en', 'ml', 'hi']) {
      expect(within(languages).getByTestId(`invite-lang-${code}`)).toBeInTheDocument();
    }
  });
});

describe('wind card', () => {
  it('says the turbine is not fitted before anything is wired to GPIO 33', async () => {
    render(<App />);
    const card = within(await screen.findByTestId('card-wind'));
    expect(card.getByText('Not fitted')).toHaveClass('chip', 'chip--neutral');
    expect(card.getByText('No reading')).toBeInTheDocument();
    // No invented power figure: one tap cannot measure current.
    expect(card.queryByText(/mW/)).not.toBeInTheDocument();
  });

  it('goes green once the generator is turning above its threshold', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ windMillivolts: 2400, windInstalled: true }),
    );
    render(<App />);
    const card = within(await screen.findByTestId('card-wind'));
    expect(card.getByText('Generating')).toHaveClass('chip', 'chip--live');
    expect(card.getByText('2.40 V')).toBeInTheDocument();
  });

  it('stays neutral when a fitted turbine is not turning', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ windMillivolts: 120, windInstalled: true }),
    );
    render(<App />);
    const card = within(await screen.findByTestId('card-wind'));
    expect(card.getByText('Not generating')).toHaveClass('chip', 'chip--neutral');
    expect(card.getByText('0.12 V')).toBeInTheDocument();
  });
});

it('points at Reset when the simulation itself is what blocks watering', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    vi.mocked(api.state).mockResolvedValue(
      makeState({ soilState: 'wet', soilPercent: 62 }),
    );
    render(<App />);

    const card = within(await screen.findByTestId('card-plants'));
    expect(card.getByTestId('water-plants')).toBeDisabled();
    expect(card.getByTestId('water-blocked')).toHaveTextContent(/Reset in Setup/i);
  });

describe('Waste card — the camera follows the board', () => {
  it('does not offer the camera while the controller is offline', async () => {
    // Decided 2026-11-16: a recognised item ends at a bin LED, so the camera is
    // offered only while the board can light one -- Simulation mode is the way
    // to show the model without it.
    vi.mocked(api.state).mockResolvedValue(makeState({ connected: false }));
    render(<App />);

    const card = within(await screen.findByTestId('card-waste'));
    expect(card.getByTestId('open-sort-waste')).toBeDisabled();
    expect(card.getByTestId('waste-offline-note')).toHaveTextContent(/Simulation/);
  });

  it('offers it again in Simulation mode, which does not use the board', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    vi.mocked(api.state).mockResolvedValue(makeState({ connected: false }));
    render(<App />);

    const card = within(await screen.findByTestId('card-waste'));
    expect(card.getByTestId('open-sort-waste')).toBeEnabled();
    expect(card.queryByTestId('waste-offline-note')).not.toBeInTheDocument();
  });
});

describe('Our Village — the top bar', () => {
  it('names the page, with the connection state on the other side', async () => {
    // The home page used to hide its own title ("the menu names it"), which left
    // the connection pill alone at the left of the bar with nothing saying which
    // page you were on (reported 2026-11-16).
    render(<App />);
    const title = await waitFor(() => {
      const found = document.querySelector('.appbar-title');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(title.textContent).toBe('Our Village');

    const bar = document.querySelector('.appbar') as HTMLElement;
    expect(bar).toContainElement(title);
    // The pill lives in the actions block, and the title comes first in document
    // order -- which is what puts it on the left of a space-between row.
    const actions = bar.querySelector('.appbar-actions') as HTMLElement;
    expect(actions.textContent).toMatch(/Live|Offline|Simulator/);
    expect(
      title.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      session: vi.fn(),
      demoScenario: vi.fn(),
    },
  };
});


/**
 * Render the app and wait for the first village frame.
 *
 * Two things happen after `render(<App />)` that a test must not read through:
 * the sign-in gate asks `/auth/session` (one round trip), and then the first
 * `state` poll lands a tick after that.  Waiting for the pill to leave
 * "Waiting for the first frame" is waiting for the page to be *populated*, which
 * is what every assertion below is about.
 */
async function renderReady() {
  render(<App />);
  // The page prints this only while it has no frame *and* is still asking, so
  // its absence means the first answer landed — whether that answer was a
  // reading or an error.  (The pill is not enough: in Simulation it never says
  // "waiting" at all, so it would settle before the frame arrived.)
  await waitFor(() => {
    const page = document.body.textContent ?? '';
    // Both sentences are on screen from the first paint (the gate's card, then
    // the page's own note), so waiting for both to go cannot pass early.
    expect(page).not.toMatch(/Checking the session/i);
    expect(page).not.toMatch(/Waiting for the first frame/i);
  });
}

beforeEach(() => {
  vi.mocked(api.session).mockResolvedValue({
    authenticated: true,
    username: null,
    auth_enabled: false,
  });

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
    await renderReady();

    expect(await screen.findByText('Watering')).toBeInTheDocument();
    expect(screen.getByText('Rain Water Tank')).toBeInTheDocument();
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
    await renderReady();

    const card = within(await screen.findByTestId('card-lights'));
    expect(card.getByText('No sensor')).toBeInTheDocument();
    expect(card.queryByText('Dark')).not.toBeInTheDocument();
    expect(card.queryByText('Bright')).not.toBeInTheDocument();
  });

  it('says the pump will not run on an empty tank, on Auto or by hand', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ reservoirState: 'low' }));
    await renderReady();

    expect(await screen.findByTestId('pump-note')).toHaveTextContent(
      /Refill the reservoir — the pump will not run, on Auto or by hand/i,
    );
    // The card no longer carries Water/Stop: the switch is the control.
    expect(screen.queryByTestId('water-plants')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stop-watering')).not.toBeInTheDocument();
  });

  it('names the soil reading, so the pump state and the probe cannot be confused', async () => {
    // Asked 2026-11-17: "watering u have idle pill and then there is not
    // calibrated y?"  Two facts were sitting side by side and only one said
    // what it was about: the chip is the session ("Idle"), the line is the
    // soil's own reading.
    vi.mocked(api.state).mockResolvedValue(
      makeState({ soilState: 'uncalibrated', soilCalibrated: false }),
    );
    await renderReady();

    const card = within(await screen.findByTestId('card-plants'));
    expect(card.getByText('Idle')).toBeInTheDocument();
    expect(card.getByText(/^Soil: not calibrated$/)).toBeInTheDocument();
  });

  it('keeps the moisture on the soil line when the probe is calibrated', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ soilState: 'dry', soilPercent: 21 }));
    await renderReady();

    expect(await screen.findByText('Soil: dry · 21%')).toBeInTheDocument();
  });

  it('says a frame is stale once, in the top bar', async () => {
    // The pill is the one place connection state is reported; a banner saying
    // the same thing only pushed the cards down (asked for 2026-11-16).
    vi.mocked(api.state).mockResolvedValue(makeState({ stale: true, ageMs: 7200 }));
    await renderReady();

    const pill = await screen.findByTestId('connection-pill');
    expect(pill).toHaveTextContent('Stale');
    expect(screen.queryByTestId('stale-banner')).not.toBeInTheDocument();
  });

  it('shows the last frame time while live instead of a flickering millisecond count', async () => {
    await renderReady();

    const pill = await screen.findByTestId('connection-pill');
    // Wait for the frame that carries the last success time, so a slower machine
    // cannot read the pill a tick before its clock is written.
    await waitFor(() => expect(pill.textContent ?? '').toMatch(/\d{1,2}:\d{2}:\d{2}/));
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
    await renderReady();

    const pill = await screen.findByTestId('connection-pill');
    expect(pill).toHaveTextContent('Offline');
    // The reason is kept, but on the pill (hover), not as a sentence across the
    // top of the page.
    expect(pill.getAttribute('title')).toMatch(/Timed out contacting the controller/);
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument();
    expect(screen.getByText('Watering')).toBeInTheDocument();
    expect(screen.getByTestId('pump-on')).toBeDisabled();
    expect(screen.getByTestId('lights-auto')).toBeDisabled();
  });

  it('labels simulation and sends its pump command to the demo village', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    const user = userEvent.setup();
    await renderReady();

    // The pill is the only place the shell announces simulation; there is no
    // banner any more (asked for 2026-11-16).
    const pill = await screen.findByTestId('connection-pill');
    expect(pill).toHaveTextContent('Simulation');
    expect(pill.getAttribute('title')).toMatch(/invented on the laptop/i);
    expect(screen.getByTestId('connection-pill')).not.toHaveTextContent('Live');

    const start = await screen.findByTestId('pump-on');
    expect(start).toBeEnabled();
    await user.click(start);

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalled());
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PUMP_ON', mode: 'demo' }),
    );
  });

  it('leaves simulation in one press on the pill', async () => {
    // The banner that used to carry this button is gone; the pill itself is the
    // control, and it says so on hover.
    window.localStorage.setItem('village.demoMode', 'demo');
    const user = userEvent.setup();
    await renderReady();

    const pill = await screen.findByTestId('connection-pill');
    expect(pill).toHaveAttribute('role', 'button');
    await user.click(pill);

    await waitFor(() => expect(window.localStorage.getItem('village.demoMode')).toBe('live'));
    await waitFor(() => expect(screen.getByTestId('connection-pill')).toHaveTextContent('Live'));
  });

  it('reports an unconfirmed pump command instead of claiming success', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ watering: true }));
    vi.mocked(api.sendCommand).mockRejectedValue(
      new ApiError(503, 'The controller did not acknowledge the command.', {
        code: 'DEVICE_UNREACHABLE',
        confirmed: false,
      }),
    );
    const user = userEvent.setup();
    await renderReady();

    const off = await screen.findByTestId('pump-off');
    expect(off).toHaveTextContent('Off');
    await user.click(off);

    await waitFor(() =>
      expect(api.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PUMP_OFF' }),
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
    await renderReady();
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
    await renderReady();
    const card = within(await screen.findByTestId('card-solar'));
    const chip = card.getByText('Generating');
    expect(chip).toHaveClass('chip--live');
    expect(card.getByText(/3\.20 V · 4\.55 mA · 14\.6 mW/)).toBeInTheDocument();
  });

  it('says where the two taps go when there is no reading at all', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ solarMillivolts: null }));
    await renderReady();
    const card = within(await screen.findByTestId('card-solar'));
    expect(card.getAllByText('No reading').length).toBeGreaterThan(0);
    expect(card.queryByText(/GPIO/i)).not.toBeInTheDocument();
  });
});

describe('unknown readings', () => {
  it('never claims Idle, Off or "not commissioned" without a frame', async () => {
    vi.mocked(api.state).mockRejectedValue(new Error('backend down'));
    await renderReady();

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

describe('Our Village — the microphone stands alone', () => {
  it('centres the microphone with the language choices under it', async () => {
    await renderReady();
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
    await renderReady();
    const languages = await screen.findByRole('group', { name: 'Language' });
    for (const code of ['en', 'ml', 'hi']) {
      expect(within(languages).getByTestId(`invite-lang-${code}`)).toBeInTheDocument();
    }
  });
});

describe('wind card', () => {
  it('says the turbine is not fitted before anything is wired to GPIO 33', async () => {
    await renderReady();
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
    await renderReady();
    const card = within(await screen.findByTestId('card-wind'));
    expect(card.getByText('Generating')).toHaveClass('chip', 'chip--live');
    expect(card.getByText('2.40 V')).toBeInTheDocument();
  });

  it('stays neutral when a fitted turbine is not turning', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ windMillivolts: 120, windInstalled: true }),
    );
    await renderReady();
    const card = within(await screen.findByTestId('card-wind'));
    expect(card.getByText('Not generating')).toHaveClass('chip', 'chip--neutral');
    expect(card.getByText('0.12 V')).toBeInTheDocument();
  });
});

it('points at Reset when the simulated tank is empty', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    vi.mocked(api.state).mockResolvedValue(makeState({ reservoirState: 'low' }));
    await renderReady();

    expect(await screen.findByTestId('pump-note')).toHaveTextContent(/Reset in Setup/i);
  });

describe('Waste card — the camera follows the board', () => {
  it('does not offer the camera while the controller is offline', async () => {
    // Decided 2026-11-16: a recognised item ends at a bin LED, so the camera is
    // offered only while the board can light one -- Simulation mode is the way
    // to show the model without it.
    vi.mocked(api.state).mockResolvedValue(makeState({ connected: false }));
    await renderReady();

    const card = within(await screen.findByTestId('card-waste'));
    expect(card.getByTestId('open-sort-waste')).toBeDisabled();
    expect(card.getByTestId('waste-offline-note')).toHaveTextContent(/Simulation/);
  });

  it('offers it again in Simulation mode, which does not use the board', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    vi.mocked(api.state).mockResolvedValue(makeState({ connected: false }));
    await renderReady();

    const card = within(await screen.findByTestId('card-waste'));
    expect(card.getByTestId('open-sort-waste')).toBeEnabled();
    expect(card.queryByTestId('waste-offline-note')).not.toBeInTheDocument();
  });
});

describe('the simulation lab: lamps, the light slider and the pump', () => {
  beforeEach(() => {
    window.localStorage.setItem('village.demoMode', 'demo');
  });

  it('draws five white lamps and lights them when the streetlights are commanded on', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ lightsMode: 'manual_on', lightsCommanded: true }),
    );
    await renderReady();

    const strip = screen.getByTestId('lamp-strip');
    expect(strip).toHaveAttribute('data-on', 'true');
    expect(within(strip).getAllByTestId(/^lamp-\d+$/)).toHaveLength(5);
    // One pin, five lamps: all of them, every time.
    for (const lamp of within(strip).getAllByTestId(/^lamp-\d+$/)) {
      expect(lamp).toHaveAttribute('data-on', 'true');
    }
  });

  it('leaves the lamps off when the reading is bright, and hides the lab in live mode', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ lightsMode: 'auto', lightsCommanded: false }),
    );
    await renderReady();

    expect(screen.getByTestId('lamp-strip')).toHaveAttribute('data-on', 'false');

    // Not a live control: the board's own LEDs are what matter there.
    cleanup();
    window.localStorage.setItem('village.demoMode', 'live');
    await renderReady();
    expect(screen.queryByTestId('lamp-lab')).not.toBeInTheDocument();
  });

  it('posts the slider position as the firmware metric, once per gesture', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ lightMetric: 1820 }));
    vi.mocked(api.demoScenario).mockResolvedValue({ status: {}, physical: false });
    await renderReady();

    const slider = within(screen.getByTestId('light-slider')).getByRole('slider');
    // Dark at the room's own "light off" reading.
    expect(screen.getByTestId('light-slider-word')).toHaveTextContent('Dark');

    fireEvent.change(slider, { target: { value: '3000' } });
    expect(screen.getByTestId('light-slider-word')).toHaveTextContent('Bright');

    // Debounced: the drag is one instruction.
    await waitFor(() =>
      expect(api.demoScenario).toHaveBeenCalledWith({ light_metric: 3000 }),
    );
    expect(
      vi.mocked(api.demoScenario).mock.calls.filter(
        (call) => (call[0] as { light_metric?: number }).light_metric === 3000,
      ),
    ).toHaveLength(1);
  });

  it('says whether the pump is on, so a spoken "water the plants" is visible on the page', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ watering: true }));
    await renderReady();

    const pump = screen.getByTestId('pump-state');
    expect(pump).toHaveAttribute('data-on', 'true');
    expect(pump).toHaveTextContent('Pump on');

    cleanup();
    vi.mocked(api.state).mockResolvedValue(makeState({ watering: false }));
    await renderReady();
    expect(screen.getByTestId('pump-state')).toHaveAttribute('data-on', 'false');
    expect(screen.getByTestId('pump-state')).toHaveTextContent('Pump off');
  });
});

describe('the pump switch', () => {
  it('holds the pump on regardless of the soil, and hands it back on Auto', async () => {
    const user = userEvent.setup();
    // Wet soil: the rules would keep it off, which is exactly the point of the
    // manual switch -- and there is no commissioning gate to get in the way.
    vi.mocked(api.state).mockResolvedValue(makeState({ soilPercent: 62, watering: false }));
    vi.mocked(api.sendCommand).mockResolvedValue({
      confirmed: true,
      mode: 'live',
      physical: true,
      error: null,
      ack: { result: 'ACCEPTED', reason_code: 'PUMP_MANUAL_ON', reason: 'Pump switched on by hand.' },
    } as never);
    await renderReady();

    expect(screen.getByTestId('pump-auto')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pump-state')).toHaveTextContent('Pump off');

    await user.click(screen.getByTestId('pump-on'));
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PUMP_ON' }),
    );

    await user.click(screen.getByTestId('pump-off'));
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PUMP_OFF' }),
    );

    await user.click(screen.getByTestId('pump-auto'));
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PUMP_AUTO' }),
    );
  });

  it('shows the switch with the board away and in Simulation, and reads the frame', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ watering: true }));
    await renderReady();
    // The frame says the pump is running; the row reports it.
    expect(screen.getByTestId('pump-state')).toHaveTextContent('Pump on');
    expect(screen.getByTestId('pump-manual')).toBeInTheDocument();

    // Not a simulation-only control any more: the board has the mode too.
    cleanup();
    window.localStorage.setItem('village.demoMode', 'live');
    await renderReady();
    expect(screen.getByTestId('pump-manual')).toBeInTheDocument();
  });
});

/**
 * The words a visitor reads at the exhibit.  Asked for 2026-11-17: the glyph
 * alone did not say what it was for, "Open camera" did not say what pressing
 * it does, and the turbine note explained the board's missing inputs instead of
 * telling the visitor what is measured.
 */
describe('Our Village — the words on the page', () => {
  it('names the microphone, and keeps it one press target', async () => {
    await renderReady();

    const mic = await screen.findByTestId('start-voice');
    expect(mic).toHaveTextContent('Talk to Sara');
    expect(mic).toHaveAttribute('aria-label', 'Talk to Sara');
  });

  it('calls the waste button what it does', async () => {
    await renderReady();

    const card = within(await screen.findByTestId('card-waste'));
    expect(card.getByText('Identify waste')).toBeInTheDocument();
    expect(card.queryByText('Open camera')).not.toBeInTheDocument();
  });

  it('says the turbine measures volts and not power', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ windMillivolts: 1200, windInstalled: true }),
    );
    await renderReady();

    const card = within(await screen.findByTestId('card-wind'));
    expect(card.getByText('1.20 V')).toBeInTheDocument();
    expect(card.getByText('Voltage measured; power is not measured.')).toBeInTheDocument();
    expect(card.queryByText(/second input/i)).not.toBeInTheDocument();
  });
});

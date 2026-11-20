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
      demoReset: vi.fn(),
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
  // Every test starts in the default language unless it says otherwise.
  window.localStorage.removeItem('village.voiceLanguage');
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
    // The Lights card carries the sensor reading as a chip, and the row repeats
    // it beside the lamps ("Outside: Dark") — two different facts, both shown.
    const lightsCard = within(screen.getByTestId('card-lights'));
    expect(lightsCard.getAllByText('Dark').length).toBeGreaterThan(0);
    expect(screen.getByTestId('outside-reading')).toHaveTextContent('Outside: Dark');
    expect(screen.getByTestId('streetlights-reading')).toHaveTextContent(/Streetlights: (On|Off)/);
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
    // Both the chip and the row's own reading say the sensor is missing — and
    // neither invents a level.
    expect(card.getAllByText('No sensor').length).toBeGreaterThan(0);
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
    // The chip answers "what is the pump doing", never the vague "Idle".
    expect(card.getByText('Pump off')).toBeInTheDocument();
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
    expect(pill.getAttribute('title') ?? '').toMatch(/Last news from the controller/i);
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
    expect(card.getByText(/Voltage 0.14 V · Current 0.00 mA · Power 0.0 mW/)).toBeInTheDocument();
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
    expect(card.getByText(/Voltage 3.20 V · Current 4.55 mA · Power 14.6 mW/)).toBeInTheDocument();
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
    // With no frame, a card reports nothing at all: its chip already says
    // "Status unknown", so "No reading" underneath it was the same fact twice
    // (asked 2026-11-18).  The waste card keeps only its chip and its button.
    expect(screen.queryByText('No reading')).not.toBeInTheDocument();
    expect(screen.queryByText('No soil reading yet')).not.toBeInTheDocument();
    expect(screen.queryByText('No item yet')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('card-waste')).getByTestId('open-sort-waste')).toBeInTheDocument();

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

    // The three pills say what they are ("English · हिन्दी · മലയാളം"), so the
    // word "Language" above them was furniture (asked 2026-11-18).  The group
    // still carries that name for a screen reader.
    expect(screen.queryByText('Language')).toBeNull();
    expect(languages).toHaveAccessibleName('Language');
  });

  it('still offers all three spoken languages under the microphone', async () => {
    await renderReady();
    const languages = await screen.findByRole('group', { name: 'Language' });
    for (const code of ['en', 'hi', 'ml']) {
      expect(within(languages).getByTestId(`invite-lang-${code}`)).toBeInTheDocument();
    }
  });
});

describe('wind card', () => {
  it('says the turbine is not fitted before anything is wired to GPIO 33', async () => {
    await renderReady();
    const card = within(await screen.findByTestId('card-wind'));
    expect(card.getByText('Not fitted')).toHaveClass('chip', 'chip--neutral');
    // No placeholder line: the chip already says the turbine is not fitted, and
    // "No reading" under it repeated that in worse words (2026-11-18).
    expect(card.queryByText('No reading')).not.toBeInTheDocument();
    // Nothing is wired, so there is no circuit to measure: no readings line at
    // all rather than a zero that was never taken.
    expect(card.queryByText(/mW/)).not.toBeInTheDocument();
    expect(card.getByTestId('wind-live-note')).toHaveTextContent(/No turbine is wired/);
  });

  it('shows voltage, current and power calculated from the resistor', async () => {
    // 230 mV across 47 ohm = 4.89 mA; the generator is that plus the lit LED's
    // 2.8 V = 3.03 V; power = 3.03 V x 4.89 mA = 14.8 mW.  These are the board's
    // own numbers, not a second calculation in the page.
    vi.mocked(api.state).mockResolvedValue(
      makeState({ windMillivolts: 230, windInstalled: true }),
    );
    await renderReady();
    const card = within(await screen.findByTestId('card-wind'));
    expect(card.getByText('Generating')).toHaveClass('chip', 'chip--live');
    expect(card.getByTestId('wind-readings')).toHaveTextContent(
      'Voltage 3.03 V · Current 4.89 mA · Power 14.8 mW',
    );
    expect(card.getByTestId('wind-help')).toHaveTextContent(
      'Current is calculated from the voltage across a 47 Ω resistor.',
    );
    expect(card.queryByText(/No measurable output/)).not.toBeInTheDocument();
  });

  it('shows no voltage at all while the LED is dark, and says why', async () => {
    // 12 mV is the ADC's own noise: below the noise floor the LED is not
    // conducting, so there is no current to divide and no generator voltage to
    // estimate.  Showing 2.8 V here would be the mistake this guards.
    vi.mocked(api.state).mockResolvedValue(
      makeState({ windMillivolts: 12, windInstalled: true }),
    );
    await renderReady();
    const card = within(await screen.findByTestId('card-wind'));
    expect(card.getByText('Not generating')).toHaveClass('chip', 'chip--neutral');
    expect(card.getByTestId('wind-readings')).toHaveTextContent(
      'Voltage — · Current 0.00 mA · Power 0.0 mW',
    );
    expect(card.getByTestId('wind-help')).toHaveTextContent(/^No measurable output/);
    expect(card.queryByText('2.80 V')).not.toBeInTheDocument();
  });

  it('shows nothing rather than a zero when the controller is offline', async () => {
    // A missing frame is not "0 mA": nothing was measured, so the card says
    // nothing and the chip carries the state.  An invented zero would be a
    // reading that never happened.
    vi.mocked(api.state).mockResolvedValue(makeState({ connected: false }));
    await renderReady();
    const card = within(await screen.findByTestId('card-wind'));
    expect(card.queryByTestId('wind-readings')).not.toBeInTheDocument();
  });

  it('shows nothing for a board whose firmware predates this reading', async () => {
    // An older image reports volts and no `measuring`/`current_ma`.  It cannot
    // say whether current flows, so its volts must not be presented as
    // "0.00 mA" -- that would be a number the board never measured.
    const frame = makeState({ windMillivolts: 230, windInstalled: true });
    const wind = frame.status?.sensors.wind;
    if (wind) {
      delete wind.measuring;
      delete wind.current_ma;
      delete wind.power_mw;
    }
    vi.mocked(api.state).mockResolvedValue(frame);
    await renderReady();
    const card = within(await screen.findByTestId('card-wind'));
    expect(card.queryByTestId('wind-readings')).not.toBeInTheDocument();
  });

  it('shows nothing rather than an old number when the frame is stale', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ stale: true, windMillivolts: 230, windInstalled: true }),
    );
    await renderReady();
    const card = within(await screen.findByTestId('card-wind'));
    expect(card.queryByTestId('wind-readings')).not.toBeInTheDocument();
  });
});

it('points at Reset when the simulated tank is empty', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    vi.mocked(api.state).mockResolvedValue(makeState({ reservoirState: 'low' }));
    await renderReady();

    expect(await screen.findByTestId('pump-note')).toHaveTextContent(/Reset demo/i);
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

    const slider = within(screen.getByTestId('sim-outside')).getByRole('slider');
    // Dark at the room's own "light off" reading.
    expect(screen.getByTestId('sim-outside-value')).toHaveTextContent('Dark');

    fireEvent.change(slider, { target: { value: '3000' } });
    expect(screen.getByTestId('sim-outside-value')).toHaveTextContent('Bright');

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
    expect(pump).toHaveTextContent('Pump running');

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

  it('shows the pump running when the manual switch holds it on, not the rules', async () => {
    // Reported 2026-11-20: with the switch on On the pump runs, but the card
    // said "Pump off" and the watering animation never drew, because both were
    // keyed on the controller's session state (which is idle for a manual On).
    vi.mocked(api.state).mockResolvedValue(
      makeState({ pumpMode: 'on', pumpCommanded: true, watering: false, soilPercent: 62 }),
    );
    await renderReady();

    const pump = screen.getByTestId('pump-state');
    expect(pump).toHaveAttribute('data-on', 'true');
    expect(pump).toHaveTextContent('Pump running');
    expect(document.querySelector('.sim-picture--plant')?.getAttribute('data-pumping')).toBe('true');
    expect(screen.getByTestId('water-why')).toHaveTextContent(/on/i);
  });

  it('shows the switch with the board away and in Simulation, and reads the frame', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ watering: true }));
    await renderReady();
    // The frame says the pump is running; the row reports it.
    expect(screen.getByTestId('pump-state')).toHaveTextContent('Pump running');
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

  it('reports all three readings from the board and explains the circuit', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ windMillivolts: 230, windInstalled: true }),
    );
    await renderReady();

    const card = within(await screen.findByTestId('card-wind'));
    expect(card.getByTestId('wind-readings')).toHaveTextContent(
      'Voltage 3.03 V · Current 4.89 mA · Power 14.8 mW',
    );
    // The sentence names the resistor and the LED's measured forward voltage, so
    // the reader can check the arithmetic rather than trust a number.
    expect(card.getByTestId('wind-help')).toHaveTextContent(
      'using the LED’s measured forward voltage of 2.8 V',
    );
    expect(card.queryByText(/power is not measured/i)).not.toBeInTheDocument();
  });
});

/**
 * The simulation lab, from a visitor's side: change a condition, watch the
 * village answer, read why.  Every case here also checks the promise the lab
 * makes — nothing in it may reach the board (asked for 2026-11-17).
 */
describe('the simulation lab changes conditions and explains itself', () => {
  beforeEach(() => {
    window.localStorage.setItem('village.demoMode', 'demo');
    vi.mocked(api.demoScenario).mockReset();
    vi.mocked(api.demoScenario).mockResolvedValue({ status: {}, physical: false });
    vi.mocked(api.demoReset).mockReset();
    vi.mocked(api.demoReset).mockResolvedValue({ status: {}, physical: false });
  });

  afterEach(() => {
    // The promise, in every case: no actuator command left this page.
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('says what the lab is for, and that the model is not controlled', async () => {
    await renderReady();

    expect(await screen.findByTestId('sim-intro')).toHaveTextContent(
      'Try changing the light, soil and water conditions. See how the village responds.',
    );
    expect(screen.getByTestId('sim-intro')).toHaveTextContent(
      'Simulation — physical model is not controlled.',
    );
  });

  it('keeps the whole lab off the Live page', async () => {
    window.localStorage.setItem('village.demoMode', 'live');
    await renderReady();

    // The lab's *controls* are what Live must not carry.  The pictures are not
    // lab controls — they are on every card in both modes (2026-11-18).
    for (const id of ['sim-intro', 'sim-presets', 'sim-soil', 'sim-tank-low', 'sim-outside', 'sim-panel-light', 'sim-wind-speed', 'try-sample']) {
      expect(screen.queryByTestId(id), id).not.toBeInTheDocument();
    }
  });

  it('posts the soil moisture without touching the pump mode', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ soilPercent: 60, soilState: 'wet' }));
    await renderReady();

    const slider = within(await screen.findByTestId('sim-soil')).getByRole('slider');
    fireEvent.change(slider, { target: { value: '12' } });

    await waitFor(() => expect(api.demoScenario).toHaveBeenCalledWith({ soil_pct: 12 }));
    const payloads = vi.mocked(api.demoScenario).mock.calls.map((call) => call[0] as Record<string, unknown>);
    expect(payloads.every((payload) => !('pump_manual' in payload))).toBe(true);
    expect(payloads.every((payload) => !('lights_mode' in payload))).toBe(true);
  });

  it('offers the tank the two answers its two wires can give', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ reservoirState: 'available' }));
    const user = userEvent.setup();
    await renderReady();

    await user.click(await screen.findByTestId('sim-tank-low'));
    await waitFor(() => expect(api.demoScenario).toHaveBeenCalledWith({ reservoir: 'low' }));

    cleanup();
    vi.mocked(api.state).mockResolvedValue(makeState({ reservoirState: 'low' }));
    await renderReady();
    expect(screen.getByTestId('sim-tank-low')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sim-tank-available')).toHaveAttribute('aria-pressed', 'false');
  });

  it('gives the controller\'s own reason on Auto', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ watering: false, soilState: 'dry', soilPercent: 20 }),
    );
    await renderReady();

    expect(await screen.findByTestId('water-why')).toHaveTextContent(
      /Soil is dry and water is available/i,
    );
  });

  it('says a manual On cannot run the pump while the water is low', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ pumpMode: 'on', watering: false, reservoirState: 'low' }),
    );
    await renderReady();

    expect(await screen.findByTestId('water-why')).toHaveTextContent(
      'Manual On cannot run the pump while the water is low.',
    );
  });

  it('shows the pump state on the chip, never a vague Idle', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ watering: true }));
    await renderReady();

    const card = within(await screen.findByTestId('card-plants'));
    expect(card.getByText('Pump running')).toBeInTheDocument();
    expect(card.queryByText('Idle')).not.toBeInTheDocument();
  });

  it('separates the surroundings from the streetlights, and explains Auto', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ lightBrightness: 'bright', lightsMode: 'auto', lightsCommanded: false }),
    );
    await renderReady();

    expect(await screen.findByTestId('outside-reading')).toHaveTextContent('Outside: Bright');
    expect(screen.getByTestId('streetlights-reading')).toHaveTextContent('Streetlights: Off');
    expect(screen.getByTestId('lights-why')).toHaveTextContent(
      'It is bright and Auto is selected → streetlights off.',
    );
  });

  it('says a manual On is why the lamps are on, rather than blaming Auto', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ lightBrightness: 'bright', lightsMode: 'manual_on', lightsCommanded: true }),
    );
    await renderReady();

    expect(await screen.findByTestId('lights-why')).toHaveTextContent(
      'Manual On selected → streetlights stay on.',
    );
  });

  it('drives the solar panel and the windmill from their own sliders', async () => {
    await renderReady();

    fireEvent.change(within(await screen.findByTestId('sim-panel-light')).getByRole('slider'), {
      target: { value: '20' },
    });
    await waitFor(() => expect(api.demoScenario).toHaveBeenCalledWith({ solar_light: 0.2 }));

    fireEvent.change(within(await screen.findByTestId('sim-wind-speed')).getByRole('slider'), {
      target: { value: '90' },
    });
    await waitFor(() => expect(api.demoScenario).toHaveBeenCalledWith({ wind_speed: 0.9 }));
  });

  it('runs the same circuit in the lab, and says it is simulated', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    vi.mocked(api.state).mockResolvedValue(makeState({ windMillivolts: 230, windInstalled: true }));
    await renderReady();

    const card = within(await screen.findByTestId('card-wind'));
    // Same arithmetic as the board, with the simulation named.
    expect(card.getByTestId('wind-readings')).toHaveTextContent(
      'Voltage 3.03 V · Current 4.89 mA · Power 14.8 mW',
    );
    expect(card.getByTestId('wind-help')).toHaveTextContent(
      /^Simulated with the same circuit as the board/,
    );
  });
});

describe('the quick demonstrations', () => {
  beforeEach(() => {
    window.localStorage.setItem('village.demoMode', 'demo');
    vi.mocked(api.demoScenario).mockReset();
    vi.mocked(api.demoScenario).mockResolvedValue({ status: {}, physical: false });
    vi.mocked(api.demoReset).mockReset();
    vi.mocked(api.demoReset).mockResolvedValue({ status: {}, physical: false });
  });

  afterEach(() => {
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('Night-time sets the outside light to dark and the lamps to Auto', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(await screen.findByTestId('preset-night'));
    await waitFor(() =>
      expect(api.demoScenario).toHaveBeenCalledWith({ light_metric: 1820, lights_mode: 'auto' }),
    );
    expect(screen.getByTestId('preset-note')).toHaveTextContent(
      'Night-time: outside light set to dark, streetlights on Auto.',
    );
  });

  it('Dry soil sets dry moisture, water available and the pump on Auto', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(await screen.findByTestId('preset-dry'));
    await waitFor(() =>
      expect(api.demoScenario).toHaveBeenCalledWith({
        soil_pct: 20,
        reservoir: 'available',
        pump_manual: 'auto',
      }),
    );
    expect(screen.getByTestId('preset-note')).toHaveTextContent(/water available, pump on Auto/i);
  });

  it('Low water sets dry soil and a low tank so pumping is blocked', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(await screen.findByTestId('preset-low'));
    await waitFor(() =>
      expect(api.demoScenario).toHaveBeenCalledWith({
        soil_pct: 20,
        reservoir: 'low',
        pump_manual: 'auto',
      }),
    );
    expect(screen.getByTestId('preset-note')).toHaveTextContent(/watering is blocked/i);
  });

  it('Reset demo restores the defaults and says so', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(await screen.findByTestId('preset-reset'));
    await waitFor(() => expect(api.demoReset).toHaveBeenCalled());
    expect(screen.getByTestId('preset-note')).toHaveTextContent(/back to its starting conditions/i);
  });
});

describe('the waste samples are not the classifier', () => {
  beforeEach(() => {
    window.localStorage.setItem('village.demoMode', 'demo');
  });

  afterEach(() => {
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('opens a labelled set of preset items', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(await screen.findByTestId('try-sample'));
    const dialog = await screen.findByTestId('waste-samples');
    expect(within(dialog).getByRole('heading', { name: 'Try a sample' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/not a camera result/i);
    for (const id of ['banana', 'bottle', 'newspaper', 'glass', 'battery']) {
      expect(within(dialog).getByTestId(`waste-sample-${id}`)).toBeInTheDocument();
    }
  });

  it('answers with the same routing rules the camera result uses', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(await screen.findByTestId('try-sample'));
    await user.click(await screen.findByTestId('waste-sample-bottle'));

    const result = await screen.findByTestId('waste-sample-result');
    expect(result).toHaveTextContent('Plastic');
    expect(result).toHaveTextContent(/Empty and rinse it/i);
    // A sample lights no bin: nothing was classified.
    expect(result).toHaveTextContent(/No bin LED is lit for a sample/i);
  });

  it('sends a glass bottle to the recycling route rather than a bin', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(await screen.findByTestId('try-sample'));
    await user.click(await screen.findByTestId('waste-sample-glass'));

    const result = await screen.findByTestId('waste-sample-result');
    expect(result).toHaveTextContent(/Keep separate/i);
    expect(result).toHaveTextContent(/Gram Sahayak/);
  });
});

/**
 * One language for the page, the panel and Sara's voice (asked 2026-11-17).
 *
 * The selector used to change only what Sara spoke; it now changes the
 * interface too.  These tests pin the three things that matter about that:
 * the page really re-renders in the chosen language, the choice survives a
 * reload, and **changing it touches nothing in the village** — no command, no
 * demo scenario, no reset.  A language is a way of reading the page, not an
 * action on it.
 */
describe('the language selector governs the whole page', () => {
  it('is English when no preference has been stored', async () => {
    await renderReady();
    expect(await screen.findByText('Watering')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByText('Rain Water Tank')).toBeInTheDocument();
    expect(screen.getByText('Talk to Sara')).toBeInTheDocument();
  });

  it('switches the page to Hindi, and sends nothing to the village', async () => {
    await renderReady();

    const languages = await screen.findByRole('group', { name: 'Language' });
    await userEvent.click(within(languages).getByTestId('invite-lang-hi'));

    // The same cards, in Hindi — including the two words a visitor reads first.
    expect(await screen.findByText('सिंचाई')).toBeInTheDocument();
    expect(screen.getByText('बारिश का पानी टैंक')).toBeInTheDocument();
    expect(screen.getByText('सारा से बात करें')).toBeInTheDocument();
    expect(screen.queryByText('Watering')).not.toBeInTheDocument();

    // …and the document says so, for screen readers and font fallback.
    expect(document.documentElement.lang).toBe('hi');

    // A language change is not an action on the village.
    expect(api.sendCommand).not.toHaveBeenCalled();
    expect(api.demoScenario).not.toHaveBeenCalled();
    expect(api.demoReset).not.toHaveBeenCalled();
    // The page was not re-mounted, either: the cards are the same cards.
    expect(screen.getByTestId('card-plants')).toBeInTheDocument();
  });

  it('switches to Malayalam, and back, without leaving a raw key on screen', async () => {
    await renderReady();
    const languages = await screen.findByRole('group', { name: 'Language' });

    await userEvent.click(within(languages).getByTestId('invite-lang-ml'));
    expect(await screen.findByText('നനയ്ക്കൽ')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ml');
    // No dotted key leaked into the text.
    expect(document.body.textContent ?? '').not.toMatch(/\b(page|card|sim|chip|tank|pump)\.[a-z]/i);

    await userEvent.click(within(languages).getByTestId('invite-lang-en'));
    expect(await screen.findByText('Watering')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('remembers the choice across a reload', async () => {
    await renderReady();
    const languages = await screen.findByRole('group', { name: 'Language' });
    await userEvent.click(within(languages).getByTestId('invite-lang-hi'));
    expect(window.localStorage.getItem('village.voiceLanguage')).toBe('hi');

    // A reload is a fresh mount reading the same storage.
    cleanup();
    await renderReady();
    expect(await screen.findByText('सिंचाई')).toBeInTheDocument();
  });

  it('shows the same language in Sara’s panel as on the page', async () => {
    vi.mocked(api.voiceReadiness).mockResolvedValue({
      whisper: { ready: true, message: 'ready' },
      tts: { ready: true, message: 'ready', languages: ['en', 'hi', 'ml'] },
      unavailable_languages: [],
    } as never);
    vi.mocked(api.voiceIntents).mockResolvedValue({ intents: [], messages: {} } as never);

    await renderReady();
    const languages = await screen.findByRole('group', { name: 'Language' });
    await userEvent.click(within(languages).getByTestId('invite-lang-ml'));

    await userEvent.click(screen.getByTestId('start-voice'));
    const panel = await screen.findByTestId('voice-panel');
    // The panel has its own copy of the same selector, reading the same state.
    const inPanel = within(panel).getAllByRole('button', { name: /മലയാളം/ });
    expect(inPanel.some((button) => button.getAttribute('aria-pressed') === 'true')).toBe(true);
  });
});

/**
 * A card says a reading when it has one, and says nothing when it does not.
 *
 * Asked 2026-11-18: "watercard why do u have no reading? No meaning. Here camera
 * ready and identify waste is only needed."  The chip on each card already
 * reports the state ("Status unknown", "Camera ready"), so a second line reading
 * "No reading" / "No item yet" was the same fact twice.
 */
describe('cards with nothing to report say nothing', () => {
  it('still reports a reading the moment there is one', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ soilState: 'dry', soilCalibrated: true, soilPercent: 21 }),
    );
    await renderReady();
    const watering = within(await screen.findByTestId('card-plants'));
    expect(watering.getByText('Soil: dry · 21%')).toBeInTheDocument();
  });
});

/**
 * Every card carries a picture, in both modes.
 *
 * Asked 2026-11-18: "you have given nice rotating wind mill and solar panel in
 * respective cards. Can you give something like that for other cards in live and
 * simulation".  The pictures follow the same value the card prints — in Live the
 * controller's, in Simulation the sliders' — so they cannot say "watering" beside
 * a card that says the pump is off.
 */
describe('every card has a picture, in both modes', () => {
  it('draws all six in Live', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ soilState: 'dry', soilCalibrated: true, soilPercent: 12, reservoirState: 'low' }),
    );
    await renderReady();

    for (const id of ['picture-watering', 'picture-tank', 'picture-waste']) {
      expect(await screen.findByTestId(id), id).toBeInTheDocument();
    }
    // Solar and wind already had theirs; the lamp lives inside the light card.
    expect(document.querySelector('.sim-picture--solar')).not.toBeNull();
    expect(document.querySelector('.sim-picture--wind')).not.toBeNull();
    expect(document.querySelector('.sim-picture--lamp')).not.toBeNull();
  });

  it('draws the tank at the level its two wires report, never a percentage', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ reservoirState: 'low' }));
    await renderReady();
    const tank = document.querySelector('.sim-picture--tank');
    expect(tank?.getAttribute('data-state')).toBe('low');

    vi.mocked(api.state).mockResolvedValue(makeState({ reservoirState: 'available' }));
    cleanup();
    await renderReady();
    expect(document.querySelector('.sim-picture--tank')?.getAttribute('data-state')).toBe('available');
  });

  it('waters the plant only while the pump is running', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ soilState: 'dry', soilCalibrated: true, soilPercent: 18, watering: true }),
    );
    await renderReady();
    const plant = document.querySelector('.sim-picture--plant');
    expect(plant?.getAttribute('data-moisture')).toBe('0.18');
    expect(plant?.getAttribute('data-pumping')).toBe('true');
  });

  it('shows a probe in air as dry at 0 %, and draws the soil dry', async () => {
    // The probe reads the ADC maximum in air, which the calibration maps to
    // 0 %.  The card must say so rather than hiding the line (reported
    // 2026-11-20).
    vi.mocked(api.state).mockResolvedValue(
      makeState({ soilState: 'dry', soilCalibrated: true, soilPercent: 0, watering: false }),
    );
    await renderReady();

    const card = within(await screen.findByTestId('card-plants'));
    expect(card.getByText(/Soil: dry · 0%/)).toBeInTheDocument();
    expect(document.querySelector('.sim-picture--plant')?.getAttribute('data-moisture')).toBe('0.00');
    expect(document.querySelector('.sim-picture--plant')?.getAttribute('data-pumping')).toBe('false');
  });

  it('lights the bin the camera named, and nothing when it named none', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ wasteCategory: 'plastic' }));
    await renderReady();
    expect(document.querySelector('.sim-picture--bins')?.getAttribute('data-active')).toBe('plastic');

    vi.mocked(api.state).mockResolvedValue(makeState({ wasteCategory: null }));
    cleanup();
    await renderReady();
    expect(document.querySelector('.sim-picture--bins')?.getAttribute('data-active')).toBe('none');
  });

  it('keeps the pictures in Simulation, with the sliders beside them', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    await renderReady();

    for (const id of ['picture-watering', 'picture-tank', 'picture-waste']) {
      expect(await screen.findByTestId(id), id).toBeInTheDocument();
    }
    // The controls are still the lab's, and still there.
    expect(await screen.findByTestId('sim-soil')).toBeInTheDocument();
    expect(screen.getByTestId('sim-tank-low')).toBeInTheDocument();
  });
});

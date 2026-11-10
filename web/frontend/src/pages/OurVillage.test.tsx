import { render, screen, waitFor } from '@testing-library/react';
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
  it('shows the four everyday cards with honest values', async () => {
    render(<App />);

    expect(await screen.findByText('Plants & Watering')).toBeInTheDocument();
    expect(screen.getByText('Rainwater Tank')).toBeInTheDocument();
    expect(screen.getByText('Streetlights')).toBeInTheDocument();
    expect(screen.getByText('Waste')).toBeInTheDocument();

    expect(screen.getByText(/28%/)).toBeInTheDocument();
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    expect(screen.getByText(/light sensor reads dark/i)).toBeInTheDocument();
    expect(screen.getByText(/Paper: Unavailable/)).toBeInTheDocument();

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

    expect(await screen.findByText(/No light sensor is fitted/i)).toBeInTheDocument();
    expect(screen.queryByText(/reads dark/i)).not.toBeInTheDocument();
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
    expect(screen.getByText('Plants & Watering')).toBeInTheDocument();
    expect(screen.getByTestId('water-plants')).toBeDisabled();
    expect(screen.getByTestId('lights-auto')).toBeDisabled();
    expect(screen.getAllByText(/the controller is offline/i).length).toBeGreaterThan(0);
  });

  it('labels simulation and sends demo commands for Water Plants', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByTestId('demo-banner')).toHaveTextContent(
      /the physical board will not respond/i,
    );

    const start = await screen.findByTestId('water-plants');
    expect(start).toBeEnabled();
    await user.click(start);

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalled());
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'IRRIGATION_REQUEST', mode: 'demo' }),
    );
  });

  it('keeps Stop Watering reachable and reports an unconfirmed result', async () => {
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
    expect(stop).toHaveTextContent('Stop Watering');
    await user.click(stop);

    await waitFor(() =>
      expect(api.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'IRRIGATION_STOP' }),
      ),
    );
    expect(await screen.findByText('Not confirmed')).toBeInTheDocument();
    expect(screen.getByText(/Do not assume anything physical happened/i)).toBeInTheDocument();
  });
});

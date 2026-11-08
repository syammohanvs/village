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
      voiceReadiness: vi.fn(),
      wasteModelStatus: vi.fn(),
      voiceIntents: vi.fn(),
      settings: vi.fn(),
      demoScenario: vi.fn(),
      demoReset: vi.fn(),
    },
  };
});

function renderApp() {
  return render(<App />);
}

beforeEach(() => {
  window.history.pushState({}, '', '/');
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.sendCommand).mockResolvedValue({
    confirmed: true,
    mode: 'live',
    physical: true,
    ack: { result: 'ACCEPTED', reason_code: 'ACCEPTED', reason: 'The controller accepted the command.' },
    error: null,
  });
  vi.mocked(api.voiceReadiness).mockResolvedValue({
    ready: true,
    whisper: { ready: true, model: 'ggml-base.bin', installed: true },
    unavailable_languages: [],
  });
  vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: false });
});

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('Village dashboard', () => {
  it('shows live values, the reason panel and honest bin states', async () => {
    renderApp();

    expect(await screen.findByText('What the village is doing and why')).toBeInTheDocument();
    expect(screen.getByTestId('status-sentence')).toHaveTextContent(
      'Soil is dry and water is available, so the controller is ready to start a pulse.',
    );
    expect(screen.getByText('28%')).toBeInTheDocument();
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Auto').length).toBeGreaterThan(0);
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Live');

    const paper = screen.getByTestId('bin-paper');
    expect(within(paper).getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(within(paper).queryByText('0%')).not.toBeInTheDocument();
    expect(within(paper).getByText(/not shown as empty/i)).toBeInTheDocument();

    const labels = document.body.textContent ?? '';
    expect(labels).not.toMatch(/battery/i);
    expect(labels).not.toMatch(/litres|liters/i);
    expect(labels).not.toMatch(/energy saved/i);
    expect(labels).not.toMatch(/solar output/i);
    expect(labels).not.toMatch(/water used/i);
  });

  it('never reports a light level when no LDR is installed', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ lightInstalled: false, lightBrightness: 'unknown' }),
    );
    renderApp();

    expect(await screen.findByText('Not installed')).toBeInTheDocument();
    expect(screen.queryByText('Dark')).not.toBeInTheDocument();
    expect(screen.getByText(/No LDR wired/i)).toBeInTheDocument();
  });

  it('greys out values and says when the frame is stale', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ stale: true, ageMs: 7200 }));
    renderApp();

    expect(await screen.findByTestId('stale-banner')).toHaveTextContent(/not live/i);
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Stale');
    expect(screen.getAllByText(/not live/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Live data')).not.toBeInTheDocument();
  });

  it('says the controller is offline and never fills missing values with zero', async () => {
    vi.mocked(api.state).mockResolvedValue(
      makeState({ connected: false, stale: false, ageMs: 15000, lastError: 'Timed out contacting the controller.' }),
    );
    renderApp();

    expect(await screen.findByTestId('offline-banner')).toHaveTextContent(/controller offline/i);
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Offline');
    expect(screen.getAllByText(/not live/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId('bin-paper')).toHaveTextContent('Unavailable');
  });

  it('marks demo mode and sends simulated commands with mode demo', async () => {
    window.localStorage.setItem('village.demoMode', 'demo');
    const user = userEvent.setup();
    renderApp();

    expect(await screen.findByTestId('demo-banner')).toHaveTextContent(
      /simulated data, physical controls disabled/i,
    );

    const start = await screen.findByTestId('start-irrigation');
    expect(start).toBeEnabled();
    await user.click(start);

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalled());
    expect(api.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'IRRIGATION_REQUEST', mode: 'demo' }),
    );
    for (const call of vi.mocked(api.sendCommand).mock.calls) {
      expect(call[0]).toMatchObject({ mode: 'demo' });
    }
  });

  it('keeps Stop visible while watering and reports an unconfirmed command on 503', async () => {
    vi.mocked(api.state).mockResolvedValue(makeState({ watering: true }));
    vi.mocked(api.sendCommand).mockRejectedValue(
      new ApiError(503, 'The controller did not acknowledge the command.', {
        code: 'DEVICE_UNREACHABLE',
        confirmed: false,
      }),
    );
    const user = userEvent.setup();
    renderApp();

    const stop = await screen.findByTestId('stop-irrigation');
    expect(stop).toHaveTextContent('Stop irrigation');
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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../lib/api';
import { makeConfigDocument, makeSettings, makeState } from '../test/fixtures';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      state: vi.fn(),
      settings: vi.fn(),
      putSettings: vi.fn(),
      systemHealth: vi.fn(),
      setupChecklist: vi.fn(),
      deviceHealth: vi.fn(),
      voiceReadiness: vi.fn(),
      wasteModelStatus: vi.fn(),
      deviceConfig: vi.fn(),
      putDeviceConfig: vi.fn(),
      events: vi.fn(),
      voiceIntents: vi.fn(),
    },
  };
});

beforeEach(() => {
  window.history.pushState({}, '', '/setup');
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.events).mockResolvedValue({ events: [] });
  vi.mocked(api.settings).mockResolvedValue(makeSettings());
  vi.mocked(api.putSettings).mockImplementation(async (patch) =>
    makeSettings({ ...patch, updated_at: '2026-11-08T09:00:00Z' }),
  );
  vi.mocked(api.systemHealth).mockResolvedValue({
    status: 'ok',
    app_version: '0.1.0',
    device: { url: 'http://192.168.1.50', mode: 'simulator', reachable: true },
    server_time: '2026-11-08T09:00:00Z',
  });
  vi.mocked(api.setupChecklist).mockResolvedValue({
    items: [{ label: 'Backend running', ok: true }],
  });
  vi.mocked(api.deviceHealth).mockResolvedValue({ reachable: true, device_id: 'village-test' });
  vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: true, whisper: { ready: true } });
  vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true });
  vi.mocked(api.deviceConfig).mockResolvedValue(makeConfigDocument());
  vi.mocked(api.putDeviceConfig).mockImplementation(async (revision, config) => ({
    protocol_version: 1,
    device_id: 'village-test',
    config_revision: revision + 1,
    config,
  }));
});

describe('Setup', () => {
  it('groups connections, sensors, voice and advanced options', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Connections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sensors & Calibration' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Voice & Camera' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Advanced' })).toBeInTheDocument();
    expect(await screen.findByText(/Where the village controller lives/i)).toBeInTheDocument();
  });

  it('keeps a local draft, validates it, and only saves a valid revision', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('settings-state')).toHaveTextContent('Saved'));

    const path = await screen.findByLabelText('Waste model folder');
    await user.clear(path);

    expect(screen.getByTestId('settings-validation')).toHaveTextContent(
      /Enter the folder that holds the waste model/i,
    );
    expect(screen.getByTestId('settings-state')).toHaveTextContent('Needs attention');
    expect(screen.getByTestId('save-settings')).toBeDisabled();
    expect(api.putSettings).not.toHaveBeenCalled();

    await user.type(path, '/models/waste-test/');
    expect(screen.getByTestId('settings-state')).toHaveTextContent('Unsaved changes');
    expect(screen.queryByTestId('settings-validation')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('save-settings'));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledTimes(1));
    expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ waste_model_path: '/models/waste-test/' }),
    );
    await waitFor(() => expect(screen.getByTestId('settings-state')).toHaveTextContent('Saved'));
  });

  it('labels simulation clearly and never switches it on by itself', async () => {
    const user = userEvent.setup();
    render(<App />);

    const toggle = await screen.findByRole('switch', { name: 'Simulation mode' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);

    expect((await screen.findAllByText(/the physical board will not respond/i)).length).toBeGreaterThan(0);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps the pump commissioning controls usable for the presenter', async () => {
    const user = userEvent.setup();
    render(<App />);

    const gate = await screen.findByRole('switch', { name: 'Pump commissioning gate' });
    await user.click(gate);

    await waitFor(() => expect(api.putDeviceConfig).toHaveBeenCalled());
    expect(api.putDeviceConfig).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ irrigation: expect.objectContaining({ pump_enabled: true }) }),
      'live',
    );
  });
});

describe('setup with an unavailable service', () => {
  it('does not claim the settings are saved when they could not be read', async () => {
    vi.mocked(api.settings).mockRejectedValue(new Error('backend down'));
    window.history.pushState({}, '', '/setup');
    render(<App />);

    expect(await screen.findByText(/Something did not answer/i)).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-state')).toHaveTextContent('Unavailable');
  });

  it('offers a local checklist when the service cannot confirm one', async () => {
    vi.mocked(api.setupChecklist).mockRejectedValue(new Error('backend down'));
    window.history.pushState({}, '', '/setup');
    render(<App />);

    expect(await screen.findByText(/Local checks \(not confirmed by the service\)/i)).toBeInTheDocument();
  });
});

describe('setup save conflicts', () => {
  it('turns a 409 into words a presenter can act on', async () => {
    const { ApiError } = await import('../lib/api');
    vi.mocked(api.putSettings).mockRejectedValue(
      new ApiError(409, 'HTTP 409 Conflict: config_revision is stale', { code: 'CONFLICT' }),
    );
    const user = userEvent.setup();
    render(<App />);

    const model = await screen.findByLabelText('Waste model folder');
    await user.clear(model);
    await user.type(model, '/models/waste-v2/');
    await user.click(screen.getByTestId('save-settings'));

    expect(
      await screen.findByText('Settings changed elsewhere. Reload before saving.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/HTTP 409/)).not.toBeInTheDocument();
  });
});

describe('simulation toggle', () => {
  it('moves the slider, not just the word', async () => {
    const user = userEvent.setup();
    render(<App />);

    const toggle = await screen.findByRole('switch', { name: 'Simulation mode' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('simulation-track').className).not.toContain('is-on');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveTextContent('On');
    // The class the CSS selector needs lives on the track; on the button alone
    // the knob stayed left while the text said On.
    expect(screen.getByTestId('simulation-track').className).toContain('is-on');
    expect(await screen.findByTestId('demo-banner')).toBeInTheDocument();
  });
});

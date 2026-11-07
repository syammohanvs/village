import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../lib/api';
import { makeSettings, makeState } from '../test/fixtures';

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
    },
  };
});

beforeEach(() => {
  window.history.pushState({}, '', '/settings');
  vi.mocked(api.state).mockResolvedValue(makeState());
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
});

describe('Settings', () => {
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
});

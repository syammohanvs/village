import { describe, expect, it, vi } from 'vitest';
import { api, isLocalDemo } from './api';

/**
 * The hosted copy has no backend at all: `/api/v1/session` is answered by the
 * static host with its own index.html.  The page must then show the village
 * rather than "is the backend running?".
 *
 * Kept in its own file because the decision is sticky for the life of the page
 * (that is the point), so a file that is in local mode cannot cleanly test the
 * other path afterwards.
 */
describe('a page with no village service behind it', () => {
  it('enters the built-in demo instead of showing an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<!doctype html><html></html>',
    });
    vi.stubGlobal('fetch', fetchMock);

    const answer = await api.session();
    expect(answer.authenticated).toBe(true);
    expect(answer.guest).toBe(true);
    expect(isLocalDemo()).toBe(true);
    // ...and it said so, so the page opens in Simulation.
    expect(window.localStorage.getItem('village.demoMode')).toBe('demo');

    // From now on nothing is asked of the network: the village answers itself.
    const callsBefore = fetchMock.mock.calls.length;
    const frame = await api.state();
    expect(frame.mode).toBe('demo');
    expect(fetchMock.mock.calls.length).toBe(callsBefore);

    const light = await api.sendCommand({ type: 'LIGHTS_ON', parameters: {} });
    expect(light.confirmed).toBe(true);
    expect(light.physical).toBe(false);

    // The things this copy cannot do say so, in words.
    await expect(api.voiceTranscribe(new Blob(['x']), 'en')).rejects.toThrow(/demo copy/i);
    await expect(api.wasteClassify('data:image/jpeg;base64,AA==')).rejects.toThrow(/demo copy/i);
    vi.unstubAllGlobals();
  });

  it('reads as not installed for the services that need the models', async () => {
    expect(isLocalDemo()).toBe(true);
    expect(await api.voiceReadiness()).toMatchObject({ ready: false });
    expect(await api.wasteModelStatus()).toMatchObject({ installed: false });
  });
});

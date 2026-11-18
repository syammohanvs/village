import { describe, expect, it, vi } from 'vitest';
import { api, isLocalDemo } from './api';

/**
 * The deployed Worker with no backend configured.
 *
 * `web/frontend/worker.js` proxies `/api/*` to `VILLAGE_API_ORIGIN`; unset, it
 * answers `503 {"error":{"code":"API_ORIGIN_MISSING"}}` for every call.  That is
 * a gateway with nothing behind it, not a broken village, so the page must show
 * the built-in demo rather than "is the backend running?".
 *
 * Its own file because the decision is sticky for the life of the page.
 */
describe('the Worker with no API origin configured', () => {
  it('shows the village instead of the gateway’s refusal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () =>
        JSON.stringify({
          error: {
            code: 'API_ORIGIN_MISSING',
            message: 'VILLAGE_API_ORIGIN is not set for this deployment.',
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const answer = await api.session();
    expect(answer.authenticated).toBe(true);
    expect(await api.state()).toMatchObject({ mode: 'demo', physical: false });
    expect(isLocalDemo()).toBe(true);
    vi.unstubAllGlobals();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getSessionToken, setSessionToken, takePendingShareKey } from './api';

/**
 * The two things a page on another origin needs from this file.
 *
 * A cookie cannot be relied on there (a third-party one is refused), so the
 * signed session travels as `Authorization: Bearer`, and the visit key arrives
 * in the address as `?share=` and must not stay there.
 */

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => '{}',
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  setSessionToken(null);
});

describe('the session a hosted copy keeps', () => {
  it('travels as a bearer on every request', async () => {
    setSessionToken('signed-token');
    const fetchMock = stubFetch();
    await api.state();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer signed-token');
    // ...and it is remembered, so a reload is still signed in.
    expect(getSessionToken()).toBe('signed-token');
    vi.unstubAllGlobals();
  });

  it('sends nothing when there is no token', async () => {
    const fetchMock = stubFetch();
    await api.state();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('a visit key in the address', () => {
  it('is returned once and taken out of the URL', () => {
    window.history.pushState({}, '', '/setup?share=abc123&x=1');
    expect(takePendingShareKey()).toBe('abc123');
    // The key is gone, the rest of the address is left alone.
    expect(window.location.pathname).toBe('/setup');
    expect(window.location.search).toBe('?x=1');
    // A second check cannot re-use it.
    expect(takePendingShareKey()).toBeNull();
  });

  it('is nothing when the address does not carry one', () => {
    expect(takePendingShareKey()).toBeNull();
  });
});

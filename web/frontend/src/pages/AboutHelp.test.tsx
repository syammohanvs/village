import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../lib/api';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, profiles: vi.fn(), session: vi.fn() },
  };
});

beforeEach(() => {
  vi.mocked(api.session).mockResolvedValue({
    authenticated: true,
    username: null,
    auth_enabled: false,
  });

  window.history.pushState({}, '', '/about');
  vi.mocked(api.profiles).mockResolvedValue({ profiles: [] });
});

/**
 * The About page is the one place that states the architecture in prose, so it
 * is the page that goes stale first.  Every claim below was wrong at some point
 * (2026-11-16) and each is pinned so it cannot drift back.
 */
describe('About & Help — the architecture it states', () => {
  // The page is behind the sign-in gate, which adds one round trip before the
  // dashboard mounts, and a loaded frame after that.  Each test therefore
  // *waits for the sentence it is about* rather than reading straight after
  // render — a negative assertion made before the page exists proves nothing.
  it('says image recognition runs on the backend, not in the browser tab', async () => {
    render(<App />);
    expect(
      await screen.findByText(/runs on this laptop, in the backend/i),
    ).toBeInTheDocument();
    // The old claim, which stopped being true when the model moved off TF.js.
    expect(screen.queryByText(/Camera frames are not uploaded/i)).not.toBeInTheDocument();
  });

  it('describes the wind card as fitted rather than always a display piece', async () => {
    render(<App />);
    expect((await screen.findAllByText(/Not fitted/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/reports volts only/i)).toBeInTheDocument();
  });

  it('names the confidence bar a bin needs, and the referral bar', async () => {
    render(<App />);
    expect(await screen.findByText(/A bin needs/)).toBeInTheDocument();
    expect(screen.getByText(/70%/)).toBeInTheDocument();
    expect(screen.getByText(/needs 50%/)).toBeInTheDocument();
  });

  it('says Sara speaks the language chosen in Setup', async () => {
    render(<App />);
    expect(
      await screen.findByText(/speaks the\s+language chosen in Setup/i),
    ).toBeInTheDocument();
  });

  it('sends a visitor to Talk to Sara, not to a button called Start Speaking', async () => {
    // The microphone has a visible name now (asked for 2026-11-17), so the
    // manual has to use it: "press the microphone" made a child hunt for a
    // glyph that the page labels.
    render(<App />);
    // "Talk to Sara" is the page's own button as well as the microphone's
    // label, so this asserts the sentence rather than a count of the words.
    expect(
      (await screen.findAllByText(/microphone with its name under it/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Talk to Sara/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Start Speaking/)).not.toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { api } from '../lib/api';
import { CommandsProvider } from '../lib/commands';
import { DemoProvider } from '../lib/demo';
import { SessionProvider } from '../lib/session';
import { VillageProvider } from '../lib/village';
import { VoiceUiProvider } from '../lib/voiceUi';
import { makeState } from '../test/fixtures';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      state: vi.fn(),
      events: vi.fn(),
      settings: vi.fn(),
      wasteModelStatus: vi.fn(),
      voiceReadiness: vi.fn(),
      voiceIntents: vi.fn(),
      session: vi.fn(),
    },
  };
});

/**
 * The console shell (`VITE_LAYOUT=sidebar`) — the operator app this exhibit
 * grew out of, still in the tree behind a build flag and the tag
 * `exhibit-sidebar-2026-11-17`.
 *
 * It is tested on its own because the exhibit's shell has no side menu at all,
 * and coverage of a retained feature must not silently disappear with the
 * default it used to be.
 */
function renderConsole() {
  return render(
    <SessionProvider>
      <DemoProvider>
        <VillageProvider>
          <CommandsProvider>
            <VoiceUiProvider>
              <MemoryRouter initialEntries={['/']}>
                <Routes>
                  <Route element={<Layout />}>
                    <Route index element={<p>A page</p>} />
                  </Route>
                </Routes>
              </MemoryRouter>
            </VoiceUiProvider>
          </CommandsProvider>
        </VillageProvider>
      </DemoProvider>
    </SessionProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.session).mockResolvedValue({
    authenticated: true,
    username: 'admin',
    auth_enabled: true,
  });
  vi.mocked(api.state).mockResolvedValue(makeState());
  vi.mocked(api.events).mockResolvedValue({ events: [] });
  vi.mocked(api.settings).mockResolvedValue({} as never);
  vi.mocked(api.wasteModelStatus).mockResolvedValue({ installed: true });
  vi.mocked(api.voiceReadiness).mockResolvedValue({ ready: false });
  vi.mocked(api.voiceIntents).mockResolvedValue({ languages: [], intents: [] });
  window.localStorage.clear();
});

describe('the console shell', () => {
  it('names the page, with the connection state on the other side', async () => {
    renderConsole();
    // Two things say "Our Village" in this shell: the bar's title and the menu
    // entry.  The title is the one in the bar.
    await screen.findAllByText('Our Village');
    const title = document.querySelector('.appbar-title') as HTMLElement;
    expect(title).not.toBeNull();
    expect(title.textContent).toBe('Our Village');

    const bar = document.querySelector('.appbar') as HTMLElement;
    expect(bar).toContainElement(title);
    // The pill lives in the actions block, and the title comes first in document
    // order -- which is what puts it on the left of a space-between row.
    const actions = bar.querySelector('.appbar-actions') as HTMLElement;
    expect(actions.textContent).toMatch(/Live|Offline|Simulator/);
    expect(
      title.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('offers "Talk to Sara" in the side menu', async () => {
    renderConsole();
    expect(await screen.findByTestId('talk-to-lia')).toHaveTextContent('Talk to Sara');
  });
});

describe('the side menu can give its width back', () => {
  it('collapses to a rail and remembers it', async () => {
    const user = userEvent.setup();
    renderConsole();

    const toggle = await screen.findByTestId('sidebar-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.sidebar')).not.toHaveClass('is-rail');

    await user.click(toggle);

    expect(document.querySelector('.sidebar')).toHaveClass('is-rail');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Tooltips name the page while the words are hidden, so the icons remain
    // readable rather than mysterious.
    expect(screen.getByRole('link', { name: 'What Happened' })).toHaveAttribute(
      'title',
      'What Happened',
    );
    expect(window.localStorage.getItem('village.sidebar')).toBe('rail');
  });

  it('opens a rail that was left collapsed on this device', async () => {
    window.localStorage.setItem('village.sidebar', 'rail');
    renderConsole();
    expect(await screen.findByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.sidebar')).toHaveClass('is-rail');
  });

  it('is expanded by default, so a first visit never lands in a rail', async () => {
    renderConsole();
    expect(await screen.findByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(window.localStorage.getItem('village.sidebar')).toBeNull();
  });
});

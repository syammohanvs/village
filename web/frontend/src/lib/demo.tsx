import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Mode } from '../types';
import { setApiMode } from './api';

export const DEMO_STORAGE_KEY = 'village.demoMode';

function readStoredMode(): Mode {
  // `?mode=demo` is how the share link lands a visitor: the server redirects
  // there after signing them in, so the first screen is Simulation even on a
  // browser that has never been here.  It is read once and then taken out of
  // the address, exactly like the language and camera choices.
  try {
    const params = new URLSearchParams(window.location.search);
    const asked = params.get('mode');
    if (asked === 'demo' || asked === 'live') {
      params.delete('mode');
      const query = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
      );
      return asked;
    }
  } catch {
    /* no URL, no localStorage: live is the honest default */
  }
  try {
    const stored = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (stored === 'demo' || stored === 'live') return stored;
  } catch {
    /* storage can be unavailable in private modes */
  }
  return 'live';
}

export interface DemoContextValue {
  mode: Mode;
  demo: boolean;
  setMode: (mode: Mode) => void;
  toggle: () => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() => {
    const initial = readStoredMode();
    setApiMode(initial);
    return initial;
  });

  useEffect(() => {
    setApiMode(mode);
    try {
      window.localStorage.setItem(DEMO_STORAGE_KEY, mode);
    } catch {
      /* ignore storage failures */
    }
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  const setMode = useCallback((next: Mode) => setModeState(next), []);
  const toggle = useCallback(
    () => setModeState((current) => (current === 'demo' ? 'live' : 'demo')),
    [],
  );

  const value = useMemo<DemoContextValue>(
    () => ({ mode, demo: mode === 'demo', setMode, toggle }),
    [mode, setMode, toggle],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoContextValue {
  const value = useContext(DemoContext);
  if (!value) throw new Error('useDemo must be used inside DemoProvider');
  return value;
}

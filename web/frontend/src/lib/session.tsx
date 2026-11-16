import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { ReactNode } from 'react';

/**
 * Who is using the dashboard, and the gate in front of it.
 *
 * The app has one account (see `web/backend/app/auth.py`).  This provider asks
 * the backend once at start-up whether a session exists, and again whenever any
 * request comes back 401 — an expired cookie must show the sign-in form, not a
 * page of red cards.
 *
 * `auth_enabled` is the backend's answer, not a build flag: a deployment with
 * the gate switched off never shows a form, and this file does not need to know
 * why.
 */
export type SessionState = 'checking' | 'in' | 'out' | 'error';

export interface SessionValue {
  state: SessionState;
  username: string | null;
  error: string;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>('checking');
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const check = useCallback(async () => {
    setState('checking');
    setError('');
    try {
      const answer = await api.session();
      if (answer && answer.auth_enabled === false) {
        setState('in');
        setUsername(null);
        return;
      }
      if (answer && answer.authenticated) {
        setState('in');
        setUsername(answer.username ?? null);
        return;
      }
      setState('out');
    } catch {
      // Could not ask.  That is not a verdict, so the page says so and offers a
      // retry rather than guessing either way.
      setState('error');
      setError('The village service did not answer. Is the backend running?');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check, attempt]);

  useEffect(() => {
    const onUnauthorised = () => {
      setState('out');
      setUsername(null);
    };
    window.addEventListener('village:unauthorised', onUnauthorised);
    return () => window.removeEventListener('village:unauthorised', onUnauthorised);
  }, []);

  const signIn = useCallback(async (user: string, password: string) => {
    const answer = await api.login(user, password);
    setUsername(answer.username ?? user);
    setState('in');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUsername(null);
      setState('out');
    }
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ state, username, error, signIn, signOut, retry: () => setAttempt((n) => n + 1) }),
    [state, username, error, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

import { Suspense, lazy } from 'react';
import { useSession } from '../lib/session';
import type { ReactNode } from 'react';

const Login = lazy(() => import('../pages/Login'));

/**
 * The gate in front of the dashboard.
 *
 * Four states, and each says something different:
 *
 *  - `checking` — one request to `/auth/session` is in flight; a moment of
 *    nothing is better than flashing the dashboard and then a form.
 *  - `in` — the session cookie is valid, or the backend has the gate switched
 *    off altogether.
 *  - `out` — show the sign-in form.  Nothing of the village is mounted behind
 *    it, so an unauthenticated visitor cannot see the state or press a button.
 *  - `error` — the backend did not answer at all.  That is not a verdict on the
 *    password, so it gets its own card and a retry.
 */
export function Gate({ children }: { children: ReactNode }) {
  const { state, error, retry } = useSession();

  if (state === 'in') return <>{children}</>;

  if (state === 'checking') {
    return (
      <div className="login-page">
        <p className="hint" role="status">
          Checking the session…
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="login-page">
        <div className="login-card" data-testid="session-error">
          <h1 className="login-title">Village</h1>
          <p className="hint">{error}</p>
          <button type="button" className="btn btn--gold" onClick={retry}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="login-page"><p className="hint">Loading…</p></div>}>
      <Login />
    </Suspense>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Emblem } from '../components/Emblem';
import { errorMessage } from '../lib/api';
import { getApiBase } from '../lib/api';
import { useSession } from '../lib/session';

/**
 * The sign-in form — one account, one password.
 *
 * It is deliberately plain and says what it is for: this gate exists so that a
 * visitor cannot wander into Setup or press Water on a screen nobody is
 * watching.  The username and password live in `.env` on the laptop
 * (`VILLAGE_ADMIN_USER` / `VILLAGE_ADMIN_PASSWORD`), which is the only place
 * they are written down.
 */
export default function Login() {
  const { signIn } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [showBackend, setShowBackend] = useState(false);
  const [backendUrl, setBackendUrl] = useState(getApiBase());
  const userField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    userField.current?.focus();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await signIn(username.trim(), password);
    } catch (cause) {
      setError(errorMessage(cause));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={(event) => void submit(event)} data-testid="login-form">
        <div className="login-brand">
          <Emblem size={72} />
          <h1 className="login-title">Smart Green Village</h1>
        </div>

        <label className="field">
          <span>Username</span>
          <input
            ref={userField}
            className="input"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={busy}
            data-testid="login-username"
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            className="input"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            data-testid="login-password"
          />
        </label>

        <label className="login-show">
          <input
            type="checkbox"
            checked={show}
            onChange={(event) => setShow(event.target.checked)}
          />
          <span>Show the password</span>
        </label>

        {error && (
          <p className="error-text" role="alert" data-testid="login-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="btn btn--gold btn--large"
          disabled={busy || !username.trim() || !password}
          data-testid="login-submit"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="login-backend">
          <button
            type="button"
            className="link-btn"
            onClick={() => setShowBackend((value) => !value)}
            data-testid="login-backend-toggle"
          >
            Connect to a backend
          </button>
          {showBackend && (
            <div className="login-backend-form">
              <label className="field">
                <span>Backend URL</span>
                <input
                  className="input"
                  value={backendUrl}
                  onChange={(event) => setBackendUrl(event.target.value)}
                  placeholder="https://your-village.example.com"
                  autoComplete="off"
                  data-testid="login-backend-url"
                />
              </label>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="login-backend-save"
                onClick={() => {
                  const cleaned = backendUrl.trim().replace(/\/$/, '');
                  if (cleaned) window.localStorage.setItem('village.apiBase', cleaned);
                  else window.localStorage.removeItem('village.apiBase');
                  window.location.reload();
                }}
              >
                Save and reload
              </button>
              <p className="hint">
                The built app talks to the same address that served it.  If the
                village backend lives elsewhere (a Cloudflare Tunnel, another
                laptop), paste its URL here once and it is remembered.  Build-time
                deployments can set <code>VITE_API_BASE_URL</code> instead.
              </p>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

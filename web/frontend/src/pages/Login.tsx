import { useEffect, useRef, useState } from 'react';
import { Emblem } from '../components/Emblem';
import { errorMessage } from '../lib/api';
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
          <Emblem size={64} />
          <div>
            <p className="brand-eyebrow">Smart Green</p>
            <h1 className="login-title">Village</h1>
          </div>
        </div>

        <p className="hint">
          Sign in to control the village. This account is for the person running the exhibit;
          the username and password are set on the laptop.
        </p>

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

        <p className="hint login-foot">
          Nothing about the village is shown until you sign in. The board and the camera keep
          running either way — this only locks the screen.
        </p>
      </form>
    </div>
  );
}

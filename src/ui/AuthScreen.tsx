/**
 * AuthScreen (accounts UI for leaderboards).
 *
 * One component with three modes — Sign In, Sign Up, Forgot Password — over the
 * Auth_Service (src/storage/authService.ts), which wraps Supabase email+password
 * auth (Requirement 20.3) with a Display_Name (20.4). The service functions are
 * injected (defaulting to the real ones) so this screen is unit-testable without
 * a backend. Guests reach this screen from the Hub; "Continue as guest" leaves
 * without signing in, so guest play is never blocked (20.1).
 */

import { useCallback, useMemo, useState } from 'react';
import {
  signIn as signInSvc,
  signUp as signUpSvc,
  resetPassword as resetPasswordSvc,
  validateDisplayName,
  type AuthResult,
} from '../storage/authService';

type Mode = 'signin' | 'signup' | 'forgot';

/** Injectable auth functions, so tests pass fakes. */
export interface AuthScreenServices {
  signIn: typeof signInSvc;
  signUp: typeof signUpSvc;
  resetPassword: typeof resetPasswordSvc;
}

const defaultServices: AuthScreenServices = {
  signIn: signInSvc,
  signUp: signUpSvc,
  resetPassword: resetPasswordSvc,
};

export interface AuthScreenProps {
  /** Called with the new session user id after a successful sign in / sign up. */
  onAuthed: (userId: string) => void;
  /** Leave the auth screen without signing in (continue as guest). */
  onCancel: () => void;
  /** Injected services; defaults to the real Auth_Service. */
  services?: Partial<AuthScreenServices>;
}

export default function AuthScreen({ onAuthed, onCancel, services }: AuthScreenProps) {
  const svc = useMemo<AuthScreenServices>(() => ({ ...defaultServices, ...services }), [services]);

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Live Display_Name validation message for sign-up (20.4).
  const nameCheck = useMemo(
    () => (mode === 'signup' && displayName.length > 0 ? validateDisplayName(displayName) : null),
    [mode, displayName],
  );

  const switchMode = useCallback((m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  }, []);

  const handleResult = useCallback(
    (result: AuthResult) => {
      if (result.ok) {
        if (result.userId) onAuthed(result.userId);
        else setError('Signed in, but no session was returned. Please try again.');
      } else {
        setError(result.message);
      }
    },
    [onAuthed],
  );

  const submit = useCallback(async () => {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        handleResult(await svc.signIn(email, password));
      } else if (mode === 'signup') {
        handleResult(await svc.signUp(email, password, displayName));
      } else {
        // Forgot password: always show a neutral confirmation (do not leak
        // whether the email exists). Requirement 20.3 reset-by-email.
        await svc.resetPassword(email);
        setNotice('If an account exists for that email, a reset link has been sent.');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, mode, email, password, displayName, svc, handleResult]);

  const panel = 'w-full max-w-sm bg-slate-800 rounded-xl p-6 flex flex-col gap-4 shadow-lg';
  const input =
    'px-3 py-2 rounded bg-slate-900 text-slate-100 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400';

  const title = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create an account' : 'Reset your password';
  const submitLabel = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link';
  const canSubmit =
    !busy &&
    email.trim().length > 0 &&
    (mode === 'forgot' || password.length > 0) &&
    (mode !== 'signup' || (displayName.length > 0 && (nameCheck?.valid ?? false)));

  return (
    <section className={panel} data-testid="auth-screen" aria-label="Account">
      <h1 className="text-xl font-semibold text-slate-100">{title}</h1>

      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Email
        <input
          type="email"
          className={input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="auth-email"
          autoComplete="email"
        />
      </label>

      {mode !== 'forgot' && (
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Password
          <input
            type="password"
            className={input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="auth-password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        </label>
      )}

      {mode === 'signup' && (
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Display name
          <input
            type="text"
            className={input}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            data-testid="auth-displayname"
            autoComplete="username"
          />
          {nameCheck && !nameCheck.valid && (
            <span className="text-rose-400 text-xs" data-testid="auth-name-rule">
              {nameCheck.message}
            </span>
          )}
        </label>
      )}

      {error && (
        <p className="text-rose-400 text-sm" role="alert" data-testid="auth-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-emerald-300 text-sm" role="status" data-testid="auth-notice">
          {notice}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        data-testid="auth-submit"
        className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-sky-300"
      >
        {submitLabel}
      </button>

      {/* Mode switches. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {mode !== 'signin' && (
          <button type="button" onClick={() => switchMode('signin')} className="underline text-sky-400" data-testid="auth-mode-signin">
            Sign in
          </button>
        )}
        {mode !== 'signup' && (
          <button type="button" onClick={() => switchMode('signup')} className="underline text-sky-400" data-testid="auth-mode-signup">
            Create an account
          </button>
        )}
        {mode !== 'forgot' && (
          <button type="button" onClick={() => switchMode('forgot')} className="underline text-sky-400" data-testid="auth-mode-forgot">
            Forgot password?
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="self-start text-slate-400 underline text-sm"
        data-testid="auth-guest"
      >
        ← Continue as guest
      </button>
    </section>
  );
}

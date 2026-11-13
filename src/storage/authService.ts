/**
 * Auth_Service (task 8.2).
 *
 * A thin wrapper over Supabase Auth that gives the app email + password
 * Accounts with a Display_Name (Requirement 20.3, 20.4):
 *   - signUp(email, password, displayName): create an Account, then write the
 *     profile row that carries the Display_Name.
 *   - signIn(email, password) / signOut().
 *   - resetPassword(email): send a password-reset email.
 *   - getSession(): the current session (null when signed out / a Guest).
 *
 * The Display_Name is validated client-side (3-20 characters, only letters,
 * digits, underscores, and hyphens — Requirement 20.4) so the broken rule can
 * be surfaced immediately. Uniqueness is enforced by the Backend (the unique
 * index on lower(display_name) added in 20240102000000_accounts_and_sync.sql);
 * a duplicate surfaces here as a `displayNameTaken` result.
 *
 * The Supabase client is injected (defaulting to the shared getSupabaseClient),
 * so tests pass a lightweight fake and nothing here creates a second client.
 * Guests never call this module, so guest/offline play never touches Supabase
 * (Requirement 20.1).
 */

import { getSupabaseClient } from './supabaseClient';

/** Display_Name rules (Requirement 20.4). */
export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 20;
/** Allowed characters: letters, digits, underscores, hyphens. */
export const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** The specific Display_Name rule a candidate broke (for a precise message). */
export type DisplayNameRule = 'length' | 'characters';

/** Result of validating a Display_Name. */
export type DisplayNameValidation =
  | { valid: true }
  | { valid: false; rule: DisplayNameRule; message: string };

/**
 * Validate a Display_Name against Requirement 20.4, returning the broken rule.
 * Length is checked first, then the character set.
 */
export function validateDisplayName(name: string): DisplayNameValidation {
  if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX) {
    return {
      valid: false,
      rule: 'length',
      message: `Display name must be ${DISPLAY_NAME_MIN}-${DISPLAY_NAME_MAX} characters.`,
    };
  }
  if (!DISPLAY_NAME_PATTERN.test(name)) {
    return {
      valid: false,
      rule: 'characters',
      message: 'Display name may use only letters, digits, underscores, and hyphens.',
    };
  }
  return { valid: true };
}

/** The outcome kinds the Auth_Service returns. */
export type AuthErrorKind =
  | 'invalidDisplayName'
  | 'displayNameTaken'
  | 'invalidCredentials'
  | 'network'
  | 'unknown';

/** A successful auth call carrying the resulting user id (when known). */
export interface AuthSuccess {
  ok: true;
  userId: string | null;
}

/** A failed auth call carrying a classified error and a message to show. */
export interface AuthFailure {
  ok: false;
  kind: AuthErrorKind;
  /** When the failure is a Display_Name rule, which rule broke. */
  rule?: DisplayNameRule;
  message: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

/** A minimal session shape; `null` means signed out (a Guest). */
export interface AuthSession {
  userId: string;
}

/**
 * The slice of the Supabase client this module uses. Declared structurally so
 * tests can pass a small fake without depending on the full SDK types.
 */
export interface SupabaseLike {
  auth: {
    signUp(credentials: { email: string; password: string }): Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
    signInWithPassword(credentials: { email: string; password: string }): Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
    signOut(): Promise<{ error: { message: string } | null }>;
    resetPasswordForEmail(email: string): Promise<{ error: { message: string } | null }>;
    getSession(): Promise<{
      data: { session: { user: { id: string } } | null };
    }>;
  };
  from(table: string): {
    insert(row: Record<string, unknown>): Promise<{ error: PostgrestLikeError | null }>;
  };
}

/** The subset of a PostgREST error we classify (unique-violation code 23505). */
export interface PostgrestLikeError {
  message: string;
  code?: string;
}

/** Resolve the client to use: the injected one, else the shared client. */
function resolveClient(client?: SupabaseLike): SupabaseLike {
  return client ?? (getSupabaseClient() as unknown as SupabaseLike);
}

/** A Postgres unique-violation surfaces with SQLSTATE 23505. */
function isUniqueViolation(error: PostgrestLikeError | null): boolean {
  if (!error) return false;
  if (error.code === '23505') return true;
  // Fall back to a message match when the code is not propagated.
  return /duplicate key value|unique constraint|already (exists|taken)/i.test(
    error.message,
  );
}

/**
 * Create an Account with email + password and a Display_Name (20.3, 20.4).
 *
 * The Display_Name is validated first (returning the broken rule). On a
 * successful sign-up the profile row is written; a uniqueness violation there
 * is surfaced as `displayNameTaken`.
 */
export async function signUp(
  email: string,
  password: string,
  displayName: string,
  client?: SupabaseLike,
): Promise<AuthResult> {
  const check = validateDisplayName(displayName);
  if (!check.valid) {
    return {
      ok: false,
      kind: 'invalidDisplayName',
      rule: check.rule,
      message: check.message,
    };
  }

  const supabase = resolveClient(client);
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      return { ok: false, kind: 'unknown', message: error.message };
    }
    const userId = data.user?.id ?? null;

    // Write the profile row carrying the Display_Name. Uniqueness is enforced
    // by the Backend (unique index on lower(display_name)); a violation here
    // means the name is taken (Requirement 20.4).
    if (userId) {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({ id: userId, display_name: displayName });
      if (profileError) {
        if (isUniqueViolation(profileError)) {
          return {
            ok: false,
            kind: 'displayNameTaken',
            message: 'That display name is already taken. Please choose another.',
          };
        }
        return { ok: false, kind: 'unknown', message: profileError.message };
      }
    }

    return { ok: true, userId };
  } catch (e) {
    return { ok: false, kind: 'network', message: messageOf(e) };
  }
}

/** Sign in with email + password (Requirement 20.3). */
export async function signIn(
  email: string,
  password: string,
  client?: SupabaseLike,
): Promise<AuthResult> {
  const supabase = resolveClient(client);
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { ok: false, kind: 'invalidCredentials', message: error.message };
    }
    return { ok: true, userId: data.user?.id ?? null };
  } catch (e) {
    return { ok: false, kind: 'network', message: messageOf(e) };
  }
}

/** Sign out the current Account (Requirement 20.3). */
export async function signOut(client?: SupabaseLike): Promise<AuthResult> {
  const supabase = resolveClient(client);
  try {
    const { error } = await supabase.auth.signOut();
    if (error) return { ok: false, kind: 'unknown', message: error.message };
    return { ok: true, userId: null };
  } catch (e) {
    return { ok: false, kind: 'network', message: messageOf(e) };
  }
}

/** Send a password-reset email for the Account (Requirement 20.3). */
export async function resetPassword(
  email: string,
  client?: SupabaseLike,
): Promise<AuthResult> {
  const supabase = resolveClient(client);
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) return { ok: false, kind: 'unknown', message: error.message };
    return { ok: true, userId: null };
  } catch (e) {
    return { ok: false, kind: 'network', message: messageOf(e) };
  }
}

/** The current session, or null when signed out (a Guest). */
export async function getSession(client?: SupabaseLike): Promise<AuthSession | null> {
  const supabase = resolveClient(client);
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    return user ? { userId: user.id } : null;
  } catch {
    return null;
  }
}

/** Extract a human-readable message from an unknown thrown value. */
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'An unexpected error occurred.';
}

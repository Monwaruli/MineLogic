/**
 * Supabase client for the public MineLogic client bundle.
 *
 * The client authenticates with only the two public Backend credentials
 * (Requirement 27.8): the project URL and the anon key, both read from the
 * environment at build time:
 *   - VITE_SUPABASE_URL
 *   - VITE_SUPABASE_ANON_KEY
 *
 * The service-role key is NEVER read or referenced here, so it can never reach
 * the client bundle. Credentials are not hardcoded; they come from the Vite env
 * (which the Build_Pipeline fills from repository secrets, Requirement 27.10).
 *
 * `getSupabaseClient()` is lazy and memoized: the client is created on first
 * use and reused afterwards, so a missing env var only fails when the Backend
 * is actually needed rather than at module import (which would break local or
 * offline/guest play that never touches Supabase).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** The two env vars the client reads. Exported for diagnostics/tests. */
export const SUPABASE_URL_ENV = 'VITE_SUPABASE_URL';
export const SUPABASE_ANON_KEY_ENV = 'VITE_SUPABASE_ANON_KEY';

/** Read a Vite env var, treating empty strings as absent. */
function readEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string | undefined {
  const value = import.meta.env[name];
  return value && value.length > 0 ? value : undefined;
}

/**
 * Resolve the Supabase URL and anon key from the environment, throwing a clear
 * error naming the missing variable(s). Exported so callers can validate
 * configuration up front if they wish.
 */
export function readSupabaseConfig(): { url: string; anonKey: string } {
  const url = readEnv('VITE_SUPABASE_URL');
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY');

  const missing: string[] = [];
  if (!url) missing.push(SUPABASE_URL_ENV);
  if (!anonKey) missing.push(SUPABASE_ANON_KEY_ENV);
  if (missing.length > 0) {
    throw new Error(
      `Supabase is not configured: missing ${missing.join(' and ')}. ` +
        `Set ${SUPABASE_URL_ENV} and ${SUPABASE_ANON_KEY_ENV} in your environment ` +
        `(see .env.example).`,
    );
  }

  // The checks above narrow both to defined; assert for the type system.
  return { url: url!, anonKey: anonKey! };
}

let cached: SupabaseClient | null = null;

/**
 * Get the shared Supabase client, creating it on first use. Throws a clear
 * error if either public credential is missing from the environment.
 */
export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached;
  const { url, anonKey } = readSupabaseConfig();
  cached = createClient(url, anonKey);
  return cached;
}

/** True when both public credentials are present, so the Backend can be used. */
export function isSupabaseConfigured(): boolean {
  return readEnv('VITE_SUPABASE_URL') !== undefined && readEnv('VITE_SUPABASE_ANON_KEY') !== undefined;
}

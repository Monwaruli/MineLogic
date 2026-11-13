/// <reference types="vite/client" />

/**
 * Typed Vite environment variables.
 *
 * Only the two public Backend credentials are exposed to the client bundle
 * (Requirement 27.8): the Supabase URL and the anon key. The service-role key
 * is never read here and must never reach the client.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  readSupabaseConfig,
  isSupabaseConfigured,
  getSupabaseClient,
  SUPABASE_URL_ENV,
  SUPABASE_ANON_KEY_ENV,
} from './supabaseClient';

const URL = 'https://example.supabase.co';
const KEY = 'anon-public-key';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readSupabaseConfig', () => {
  it('returns url and anon key when both env vars are set (Req 27.8)', () => {
    vi.stubEnv(SUPABASE_URL_ENV, URL);
    vi.stubEnv(SUPABASE_ANON_KEY_ENV, KEY);
    expect(readSupabaseConfig()).toEqual({ url: URL, anonKey: KEY });
  });

  it('throws naming the missing url variable', () => {
    vi.stubEnv(SUPABASE_URL_ENV, '');
    vi.stubEnv(SUPABASE_ANON_KEY_ENV, KEY);
    expect(() => readSupabaseConfig()).toThrow(SUPABASE_URL_ENV);
  });

  it('throws naming the missing anon key variable', () => {
    vi.stubEnv(SUPABASE_URL_ENV, URL);
    vi.stubEnv(SUPABASE_ANON_KEY_ENV, '');
    expect(() => readSupabaseConfig()).toThrow(SUPABASE_ANON_KEY_ENV);
  });

  it('names both variables when both are missing', () => {
    vi.stubEnv(SUPABASE_URL_ENV, '');
    vi.stubEnv(SUPABASE_ANON_KEY_ENV, '');
    expect(() => readSupabaseConfig()).toThrow(
      new RegExp(`${SUPABASE_URL_ENV}.*${SUPABASE_ANON_KEY_ENV}`),
    );
  });

  it('treats empty-string env values as unconfigured', () => {
    vi.stubEnv(SUPABASE_URL_ENV, '');
    vi.stubEnv(SUPABASE_ANON_KEY_ENV, '');
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('reports configured when both are present', () => {
    vi.stubEnv(SUPABASE_URL_ENV, URL);
    vi.stubEnv(SUPABASE_ANON_KEY_ENV, KEY);
    expect(isSupabaseConfigured()).toBe(true);
  });
});

describe('getSupabaseClient', () => {
  it('creates a usable client with auth surface when configured', () => {
    vi.stubEnv(SUPABASE_URL_ENV, URL);
    vi.stubEnv(SUPABASE_ANON_KEY_ENV, KEY);
    const client = getSupabaseClient();
    expect(client).toBeTruthy();
    expect(typeof client.from).toBe('function');
    expect(client.auth).toBeTruthy();
  });

  it('returns the same memoized instance on repeated calls', () => {
    vi.stubEnv(SUPABASE_URL_ENV, URL);
    vi.stubEnv(SUPABASE_ANON_KEY_ENV, KEY);
    expect(getSupabaseClient()).toBe(getSupabaseClient());
  });
});

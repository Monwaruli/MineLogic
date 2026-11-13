import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateDisplayName,
  signUp,
  signIn,
  signOut,
  resetPassword,
  getSession,
  DISPLAY_NAME_MIN,
  DISPLAY_NAME_MAX,
  type SupabaseLike,
  type PostgrestLikeError,
} from './authService';

/**
 * A configurable fake of the Supabase surface authService uses. Each method
 * returns whatever the test wires up; `inserted` records profile writes.
 */
function fakeSupabase(opts: {
  signUpUserId?: string | null;
  signUpError?: { message: string } | null;
  signInUserId?: string | null;
  signInError?: { message: string } | null;
  insertError?: PostgrestLikeError | null;
  session?: { user: { id: string } } | null;
  throwOn?: 'signUp' | 'signIn' | 'signOut' | 'reset';
} = {}): { client: SupabaseLike; inserted: Record<string, unknown>[] } {
  const inserted: Record<string, unknown>[] = [];
  const client: SupabaseLike = {
    auth: {
      async signUp() {
        if (opts.throwOn === 'signUp') throw new Error('offline');
        return {
          data: { user: opts.signUpUserId === undefined ? { id: 'u1' } : opts.signUpUserId === null ? null : { id: opts.signUpUserId } },
          error: opts.signUpError ?? null,
        };
      },
      async signInWithPassword() {
        if (opts.throwOn === 'signIn') throw new Error('offline');
        return {
          data: { user: opts.signInUserId === undefined ? { id: 'u1' } : opts.signInUserId === null ? null : { id: opts.signInUserId } },
          error: opts.signInError ?? null,
        };
      },
      async signOut() {
        if (opts.throwOn === 'signOut') throw new Error('offline');
        return { error: null };
      },
      async resetPasswordForEmail() {
        if (opts.throwOn === 'reset') throw new Error('offline');
        return { error: null };
      },
      async getSession() {
        return { data: { session: opts.session ?? null } };
      },
    },
    from() {
      return {
        async insert(row: Record<string, unknown>) {
          inserted.push(row);
          return { error: opts.insertError ?? null };
        },
      };
    },
  };
  return { client, inserted };
}

describe('validateDisplayName', () => {
  it('accepts valid names (length 3-20, allowed chars)', () => {
    for (const name of ['abc', 'a_b-c', 'User_123', 'A'.repeat(DISPLAY_NAME_MAX)]) {
      expect(validateDisplayName(name)).toEqual({ valid: true });
    }
  });

  it('rejects names that are too short or too long with the length rule', () => {
    const tooShort = 'ab';
    const tooLong = 'a'.repeat(DISPLAY_NAME_MAX + 1);
    for (const bad of [tooShort, tooLong, '']) {
      const r = validateDisplayName(bad);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.rule).toBe('length');
    }
  });

  it('rejects disallowed characters with the characters rule', () => {
    for (const bad of ['has space', 'emoji😀x', 'dot.name', 'slash/x', 'paren(x)']) {
      const r = validateDisplayName(bad);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.rule).toBe('characters');
    }
  });

  it('property: valid iff length in range AND only [A-Za-z0-9_-]', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const inRange = s.length >= DISPLAY_NAME_MIN && s.length <= DISPLAY_NAME_MAX;
        const onlyAllowed = /^[A-Za-z0-9_-]+$/.test(s);
        const expected = inRange && onlyAllowed;
        expect(validateDisplayName(s).valid).toBe(expected);
      }),
    );
  });
});

describe('signUp', () => {
  it('rejects an invalid Display_Name before calling the Backend', async () => {
    const { client, inserted } = fakeSupabase();
    const r = await signUp('e@x.com', 'password123', 'ab', client);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('invalidDisplayName');
      expect(r.rule).toBe('length');
    }
    expect(inserted).toHaveLength(0);
  });

  it('creates the account and writes the profile on success', async () => {
    const { client, inserted } = fakeSupabase({ signUpUserId: 'u42' });
    const r = await signUp('e@x.com', 'password123', 'Valid_Name', client);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.userId).toBe('u42');
    expect(inserted).toEqual([{ id: 'u42', display_name: 'Valid_Name' }]);
  });

  it('surfaces a unique-violation on the profile as displayNameTaken', async () => {
    const { client } = fakeSupabase({
      signUpUserId: 'u1',
      insertError: { message: 'duplicate key value', code: '23505' },
    });
    const r = await signUp('e@x.com', 'password123', 'Taken_Name', client);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('displayNameTaken');
  });

  it('classifies a thrown error as a network failure', async () => {
    const { client } = fakeSupabase({ throwOn: 'signUp' });
    const r = await signUp('e@x.com', 'password123', 'Valid_Name', client);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('network');
  });
});

describe('signIn / signOut / resetPassword / getSession', () => {
  it('signIn returns the user id on success', async () => {
    const { client } = fakeSupabase({ signInUserId: 'u7' });
    const r = await signIn('e@x.com', 'pw', client);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.userId).toBe('u7');
  });

  it('signIn surfaces invalid credentials', async () => {
    const { client } = fakeSupabase({ signInError: { message: 'Invalid login credentials' } });
    const r = await signIn('e@x.com', 'bad', client);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('invalidCredentials');
  });

  it('signOut and resetPassword succeed', async () => {
    const { client } = fakeSupabase();
    expect((await signOut(client)).ok).toBe(true);
    expect((await resetPassword('e@x.com', client)).ok).toBe(true);
  });

  it('getSession returns the session user or null', async () => {
    const signedIn = fakeSupabase({ session: { user: { id: 'u9' } } });
    expect(await getSession(signedIn.client)).toEqual({ userId: 'u9' });
    const guest = fakeSupabase({ session: null });
    expect(await getSession(guest.client)).toBeNull();
  });
});

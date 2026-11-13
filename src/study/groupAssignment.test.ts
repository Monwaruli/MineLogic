import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assignGroup, decideGroup, type SupabaseLike, type StudyGroup } from './studyService';

/** A fake Supabase whose rpc routes to a handler. */
function fakeSupabase(
  handler: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null },
): SupabaseLike {
  return {
    async rpc(fn, args) {
      return handler(fn, args);
    },
  };
}

/**
 * A fake backend modeling the `assign_participant_group` function: a shared,
 * atomically-counted store. Each call is serialized (as the advisory lock makes
 * it), so assignments mirror the pure `decideGroup` logic. Already-assigned
 * participants return their existing group unchanged (23.5).
 */
function makeAssignmentBackend(rng: () => number = () => 0) {
  const groups = new Map<string, StudyGroup>();
  const client: SupabaseLike = {
    async rpc(fn, args) {
      if (fn !== 'assign_participant_group') return { data: null, error: { message: 'unknown' } };
      const id = args.p_participant_id as string;
      const existing = groups.get(id);
      if (existing) return { data: existing, error: null };
      let a = 0;
      let b = 0;
      for (const g of groups.values()) {
        if (g === 'Group_A') a++;
        else b++;
      }
      const chosen = decideGroup(a, b, rng);
      groups.set(id, chosen);
      return { data: chosen, error: null };
    },
  };
  return { client, groups };
}

describe('decideGroup balance logic (Requirement 23.3, 23.4)', () => {
  it('assigns the smaller group', () => {
    expect(decideGroup(2, 5)).toBe('Group_A');
    expect(decideGroup(5, 2)).toBe('Group_B');
  });

  it('breaks a tie with the rng', () => {
    expect(decideGroup(3, 3, () => 0.1)).toBe('Group_A');
    expect(decideGroup(3, 3, () => 0.9)).toBe('Group_B');
  });

  it('property: after every assignment, |A - B| <= 1 (23.4)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 300 }),
        (randoms) => {
          let a = 0;
          let b = 0;
          let i = 0;
          for (let n = 0; n < randoms.length; n++) {
            const g = decideGroup(a, b, () => randoms[i++ % randoms.length]);
            if (g === 'Group_A') a++;
            else b++;
            // Invariant must hold after EVERY assignment.
            expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });
});

describe('assignGroup wrapper (Requirement 23.3, 23.5)', () => {
  it('returns the assigned group from the RPC', async () => {
    const client = fakeSupabase(() => ({ data: 'Group_A', error: null }));
    expect(await assignGroup('p1', client)).toBe('Group_A');
  });

  it('returns null on a transport error', async () => {
    const client = fakeSupabase(() => ({ data: null, error: { message: 'boom' } }));
    expect(await assignGroup('p1', client)).toBeNull();
  });

  it('returns null for an unexpected payload', async () => {
    const client = fakeSupabase(() => ({ data: 'Group_C', error: null }));
    expect(await assignGroup('p1', client)).toBeNull();
  });

  it('assigning an already-grouped participant returns the same group (23.5)', async () => {
    const { client } = makeAssignmentBackend(() => 0.1); // first tie -> Group_A
    const first = await assignGroup('p1', client);
    const again = await assignGroup('p1', client);
    expect(first).toBe('Group_A');
    expect(again).toBe(first);
  });

  it('keeps A and B balanced across many sequential assignments (23.4)', async () => {
    const { client, groups } = makeAssignmentBackend(() => 0.1);
    for (let i = 0; i < 50; i++) {
      await assignGroup(`p${i}`, client);
      let a = 0;
      let b = 0;
      for (const g of groups.values()) (g === 'Group_A' ? a++ : b++);
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    }
  });

  it('stays balanced even when requests interleave (23.4)', async () => {
    // Fire a batch of assignments "concurrently" against the serialized backend.
    const { client, groups } = makeAssignmentBackend(() => 0.1);
    await Promise.all(
      Array.from({ length: 40 }, (_, i) => assignGroup(`c${i}`, client)),
    );
    let a = 0;
    let b = 0;
    for (const g of groups.values()) (g === 'Group_A' ? a++ : b++);
    expect(groups.size).toBe(40);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });
});

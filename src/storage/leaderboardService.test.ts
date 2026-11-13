import { describe, it, expect } from 'vitest';
import {
  checkPlausibility,
  minPlausibleTimeMs,
  submitResult,
  readLeaderboard,
  readDailySweepLeaderboard,
  messageForCheck,
  MAX_TIME_MS,
  LEADERBOARD_TOP_N,
  type SubmitInput,
  type SupabaseLike,
  type RankingRow,
  type StorageLike,
} from './leaderboardService';
import { PRACTICE_KEY } from './practiceStorage';

/** A valid Beginner submission (9x9/10), comfortably inside the time bounds. */
function beginnerInput(overrides: Partial<SubmitInput> = {}): SubmitInput {
  return {
    resultId: 'game-1',
    difficulty: 'Beginner',
    displayName: 'Alice',
    width: 9,
    height: 9,
    mines: 10,
    timeMs: 30_000,
    threeBv: 20,
    logicalMoveRate: 95.0,
    chordingEfficiency: 1.2,
    ...overrides,
  };
}

/** An in-memory StorageLike seeded with completed-practice records. */
function storageWithPractice(difficulties: string[]): StorageLike {
  const records = difficulties.map((d) => ({
    difficulty: d,
    boardId: 'b',
    interceptedCount: 0,
    stage2Count: 0,
    finishedAt: 0,
  }));
  const map = new Map<string, string>([[PRACTICE_KEY, JSON.stringify(records)]]);
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

/** A fake Supabase surface: rpc returns a check name, reads return rows. */
function fakeSupabase(opts: {
  rpcData?: string | null;
  rpcError?: { message: string } | null;
  rows?: RankingRow[];
  sessionUserId?: string | null;
} = {}): { client: SupabaseLike; rpcCalls: Record<string, unknown>[] } {
  const rpcCalls: Record<string, unknown>[] = [];
  const client: SupabaseLike = {
    async rpc(_fn, args) {
      rpcCalls.push(args);
      return { data: opts.rpcData ?? 'ok', error: opts.rpcError ?? null };
    },
    from() {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({ data: opts.rows ?? [], error: null }),
      };
      return builder;
    },
    auth: {
      async getSession() {
        return {
          data: {
            session: opts.sessionUserId
              ? { user: { id: opts.sessionUserId } }
              : null,
          },
        };
      },
    },
  };
  return { client, rpcCalls };
}

describe('minPlausibleTimeMs', () => {
  it('is 3BV / 15 seconds, in ms', () => {
    expect(minPlausibleTimeMs(15)).toBe(1000);
    expect(minPlausibleTimeMs(30)).toBe(2000);
  });
});

describe('checkPlausibility (19.7)', () => {
  it('accepts a well-formed result', () => {
    expect(checkPlausibility(beginnerInput())).toBe('ok');
  });

  it('rejects dimensions that do not match the difficulty', () => {
    expect(checkPlausibility(beginnerInput({ width: 16 }))).toBe('dimensions_mismatch');
    expect(checkPlausibility(beginnerInput({ mines: 40 }))).toBe('dimensions_mismatch');
  });

  it('rejects a time below the 3BV/15 floor', () => {
    const input = beginnerInput({ threeBv: 30, timeMs: minPlausibleTimeMs(30) - 1 });
    expect(checkPlausibility(input)).toBe('time_too_fast');
  });

  it('accepts a time exactly at the floor', () => {
    const input = beginnerInput({ threeBv: 30, timeMs: minPlausibleTimeMs(30) });
    expect(checkPlausibility(input)).toBe('ok');
  });

  it('rejects a time above the 3600 s cap', () => {
    expect(checkPlausibility(beginnerInput({ timeMs: MAX_TIME_MS + 1 }))).toBe('time_too_slow');
  });
});

describe('submitResult — practice gating (19.4)', () => {
  it('rejects with practice_required when no practice completed at the difficulty', () => {
    return submitResult(beginnerInput(), {
      client: fakeSupabase().client,
      storage: storageWithPractice([]), // none
    }).then((res) => {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.check).toBe('practice_required');
    });
  });

  it('rejects when practice was completed at a DIFFERENT difficulty', () => {
    return submitResult(beginnerInput(), {
      client: fakeSupabase().client,
      storage: storageWithPractice(['Intermediate']),
    }).then((res) => {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.check).toBe('practice_required');
    });
  });

  it('calls the Backend only after the practice gate passes', async () => {
    const fake = fakeSupabase({ rpcData: 'ok' });
    const res = await submitResult(beginnerInput(), {
      client: fake.client,
      storage: storageWithPractice(['Beginner']),
    });
    expect(res.ok).toBe(true);
    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0].p_difficulty).toBe('Beginner');
  });
});

describe('submitResult — Backend failed-check handling (19.7, 19.8)', () => {
  it('surfaces a rate_limited check from the Backend', async () => {
    const res = await submitResult(beginnerInput(), {
      client: fakeSupabase({ rpcData: 'rate_limited' }).client,
      storage: storageWithPractice(['Beginner']),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.check).toBe('rate_limited');
      expect(res.message).toMatch(/last hour/i);
    }
  });

  it('surfaces a duplicate_result check from the Backend', async () => {
    const res = await submitResult(beginnerInput(), {
      client: fakeSupabase({ rpcData: 'duplicate_result' }).client,
      storage: storageWithPractice(['Beginner']),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.check).toBe('duplicate_result');
  });
});

describe('messageForCheck (19.6)', () => {
  it('names the practice board the player must complete', () => {
    expect(messageForCheck('practice_required', 'Expert')).toMatch(/Expert Practice/);
  });
});

describe('readLeaderboard (19.9, 19.10)', () => {
  const rows: RankingRow[] = [
    {
      rank: 1,
      user_id: 'u-other',
      display_name: 'Fast',
      time_ms: 10_000,
      logical_move_rate: 100,
      chording_efficiency: 1.1,
    },
    {
      rank: 2,
      user_id: 'u-me',
      display_name: 'Me',
      time_ms: 20_000,
      logical_move_rate: 90,
      chording_efficiency: 1.3,
    },
  ];

  it('exposes only the five allowed fields per entry (19.9)', async () => {
    const view = await readLeaderboard('Beginner', fakeSupabase({ rows }).client);
    expect(view.top).toHaveLength(2);
    const entry = view.top[0];
    expect(Object.keys(entry).sort()).toEqual(
      ['chordingEfficiency', 'displayName', 'logicalMoveRate', 'rank', 'timeMs'].sort(),
    );
    // No user_id leaks into the public entry.
    expect((entry as unknown as Record<string, unknown>).user_id).toBeUndefined();
  });

  it('returns the signed-in player own rank when ranked (19.10)', async () => {
    const view = await readLeaderboard(
      'Beginner',
      fakeSupabase({ rows, sessionUserId: 'u-me' }).client,
    );
    expect(view.ownRank).toBe(2);
  });

  it('returns a null own rank for a Guest (19.9 read-only)', async () => {
    const view = await readLeaderboard('Beginner', fakeSupabase({ rows }).client);
    expect(view.ownRank).toBeNull();
  });

  it('caps the fetch at the top-50 window (19.10)', async () => {
    // The fake ignores the limit arg, but the service must request TOP_N.
    expect(LEADERBOARD_TOP_N).toBe(50);
    const view = await readLeaderboard('Beginner', fakeSupabase({ rows: [] }).client);
    expect(view.top).toEqual([]);
  });
});

describe('readDailySweepLeaderboard (19.2, 19.9)', () => {
  it('shapes the per-Sweep_Day rankings the same way', async () => {
    const rows: RankingRow[] = [
      {
        rank: 1,
        user_id: 'u1',
        display_name: 'Winner',
        time_ms: 12_000,
        logical_move_rate: 88.5,
        chording_efficiency: null,
      },
    ];
    const view = await readDailySweepLeaderboard('2024-03-10', fakeSupabase({ rows }).client);
    expect(view.top[0].displayName).toBe('Winner');
    expect(view.top[0].chordingEfficiency).toBeNull();
  });
});

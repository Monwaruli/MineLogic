import { describe, it, expect } from 'vitest';
import {
  enqueue,
  loadQueue,
  flushQueue,
  clearQueue,
  backoffDelay,
  DEFAULT_BACKOFF,
  SYNC_QUEUE_KEY,
  type SyncWrite,
  type StorageLike,
  type DeliverResult,
} from './syncQueue';

function memoryStorage(initial?: Record<string, string>): StorageLike {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const write = (over: Partial<SyncWrite> = {}): Omit<SyncWrite, 'attempts'> => ({
  id: 'game_results:u1:g1',
  table: 'game_results',
  row: { id: 'g1', user_id: 'u1', outcome: 'won' },
  onConflict: 'id',
  ...over,
});

// A sleep that records requested delays without actually waiting.
function recordingSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
  };
  return { sleep, delays };
}

describe('enqueue / loadQueue', () => {
  it('reads an empty queue from a fresh store', () => {
    expect(loadQueue(memoryStorage())).toEqual([]);
  });

  it('appends writes and reads them back with attempts initialized', () => {
    const store = memoryStorage();
    enqueue(write(), store);
    enqueue(write({ id: 'game_results:u1:g2' }), store);
    const q = loadQueue(store);
    expect(q).toHaveLength(2);
    expect(q[0]!.attempts).toBe(0);
  });

  it('re-enqueueing the same id replaces rather than duplicating', () => {
    const store = memoryStorage();
    enqueue(write({ row: { id: 'g1', v: 1 } }), store);
    enqueue(write({ row: { id: 'g1', v: 2 } }), store);
    const q = loadQueue(store);
    expect(q).toHaveLength(1);
    expect(q[0]!.row).toEqual({ id: 'g1', v: 2 });
  });

  it('never throws on a corrupt store and reads as empty', () => {
    const store = memoryStorage({ [SYNC_QUEUE_KEY]: '{not json' });
    expect(loadQueue(store)).toEqual([]);
  });
});

describe('backoffDelay', () => {
  it('increases with attempts and is capped at maxMs', () => {
    const d0 = backoffDelay(0, DEFAULT_BACKOFF);
    const d1 = backoffDelay(1, DEFAULT_BACKOFF);
    const d2 = backoffDelay(2, DEFAULT_BACKOFF);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
    expect(backoffDelay(100, DEFAULT_BACKOFF)).toBe(DEFAULT_BACKOFF.maxMs);
  });
});

describe('flushQueue — retry on failure (Requirement 20.9)', () => {
  it('delivers a succeeding write and removes it from the queue', async () => {
    const store = memoryStorage();
    enqueue(write(), store);
    const delivered: SyncWrite[] = [];
    const summary = await flushQueue(
      async (w) => {
        delivered.push(w);
        return { ok: true } as DeliverResult;
      },
      { storage: store, sleep: async () => {} },
    );
    expect(summary.delivered).toBe(1);
    expect(summary.remaining).toBe(0);
    expect(loadQueue(store)).toEqual([]);
  });

  it('retains a failing write and retries it with increasing backoff', async () => {
    const store = memoryStorage();
    enqueue(write(), store);
    const { sleep, delays } = recordingSleep();
    let calls = 0;
    const summary = await flushQueue(
      async () => {
        calls += 1;
        return { ok: false, error: 'boom' };
      },
      {
        storage: store,
        sleep,
        backoff: { baseMs: 10, factor: 2, maxMs: 1000, maxAttempts: 3 },
      },
    );
    // Tried up to maxAttempts times...
    expect(calls).toBe(3);
    // ...waited a growing delay between tries (not after the last one)...
    expect(delays.length).toBe(2);
    expect(delays[1]).toBeGreaterThan(delays[0]!);
    // ...and kept the write queued for a later flush (20.9).
    expect(summary.remaining).toBe(1);
    const q = loadQueue(store);
    expect(q[0]!.attempts).toBe(3);
  });

  it('eventually delivers a write that fails then succeeds', async () => {
    const store = memoryStorage();
    enqueue(write(), store);
    let calls = 0;
    const summary = await flushQueue(
      async () => {
        calls += 1;
        return calls < 2 ? { ok: false } : { ok: true };
      },
      { storage: store, sleep: async () => {} },
    );
    expect(summary.delivered).toBe(1);
    expect(loadQueue(store)).toEqual([]);
  });
});

describe('flushQueue — idempotent re-delivery (Requirement 20.10)', () => {
  it('re-delivering an already-delivered write leaves backend state unchanged', async () => {
    // Model the backend as a map keyed by the write's stable key; an upsert of
    // the same row is a no-op the second time.
    const backend = new Map<string, Record<string, unknown>>();
    const deliver = async (w: SyncWrite): Promise<DeliverResult> => {
      const key = String(w.row.id ?? `${w.row.user_id}:${w.row.sweep_day}`);
      backend.set(key, { ...w.row }); // upsert
      return { ok: true };
    };

    const store = memoryStorage();
    enqueue(write(), store);
    await flushQueue(deliver, { storage: store, sleep: async () => {} });
    const afterFirst = JSON.stringify([...backend.entries()]);

    // Enqueue and deliver the identical write again.
    enqueue(write(), store);
    await flushQueue(deliver, { storage: store, sleep: async () => {} });
    const afterSecond = JSON.stringify([...backend.entries()]);

    expect(afterSecond).toBe(afterFirst);
    expect(backend.size).toBe(1);
  });
});

describe('clearQueue', () => {
  it('empties the queue', () => {
    const store = memoryStorage();
    enqueue(write(), store);
    clearQueue(store);
    expect(loadQueue(store)).toEqual([]);
  });
});

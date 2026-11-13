import { describe, it, expect } from 'vitest';
import {
  mergeProgressOnFirstSignIn,
  hasMerged,
  MERGE_FLAG_PREFIX,
} from './accountSync';
import { loadQueue, type StorageLike } from './syncQueue';
import type { ProgressSnapshot } from './progressMerge';

function memoryStorage(initial?: Record<string, string>): StorageLike {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const local: ProgressSnapshot = {
  milestones: [{ id: 'm1', updatedAt: 1 }],
  gameResults: [{ id: 'g1', finishedAt: 1 }],
  completedSweepDays: [{ sweepDay: '2024-01-01', timeMs: 10 }],
};

const account: ProgressSnapshot = {
  milestones: [{ id: 'm2', updatedAt: 2 }],
  gameResults: [],
  completedSweepDays: [],
};

describe('mergeProgressOnFirstSignIn (Requirement 20.6)', () => {
  it('runs once, enqueues the union, and sets the per-account guard flag', () => {
    const store = memoryStorage();
    const r = mergeProgressOnFirstSignIn('u1', local, account, store);
    expect(r.ran).toBe(true);
    // Union = m1 + m2 (milestones) + g1 (result) + one sweep day = 4 writes.
    expect(r.enqueued).toBe(4);
    expect(r.merged.milestones.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(hasMerged('u1', store)).toBe(true);
    expect(store.getItem(`${MERGE_FLAG_PREFIX}u1`)).toBe('1');
    expect(loadQueue(store)).toHaveLength(4);
  });

  it('does not re-run or re-enqueue on a later sign-in on the same browser', () => {
    const store = memoryStorage();
    mergeProgressOnFirstSignIn('u1', local, account, store);
    const before = loadQueue(store).length;
    const second = mergeProgressOnFirstSignIn('u1', local, account, store);
    expect(second.ran).toBe(false);
    expect(second.enqueued).toBe(0);
    // Queue unchanged (merge is also idempotent, so this is safe either way).
    expect(loadQueue(store).length).toBe(before);
  });

  it('tracks the guard flag per account id', () => {
    const store = memoryStorage();
    mergeProgressOnFirstSignIn('u1', local, account, store);
    expect(hasMerged('u1', store)).toBe(true);
    expect(hasMerged('u2', store)).toBe(false);
    const other = mergeProgressOnFirstSignIn('u2', local, account, store);
    expect(other.ran).toBe(true);
  });
});

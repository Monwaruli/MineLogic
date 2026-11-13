import { describe, it, expect, beforeEach } from 'vitest';
import {
  CHECKPOINTS_KEY,
  isCheckpointPassed,
  loadAllCheckpoints,
  loadCheckpoint,
  saveCheckpointPassed,
  type StorageLike,
} from './checkpointStorage';

/** A tiny in-memory Storage stub. */
function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe('checkpointStorage', () => {
  let store: ReturnType<typeof memStorage>;
  beforeEach(() => {
    store = memStorage();
  });

  it('reads as not-passed when nothing is stored', () => {
    expect(isCheckpointPassed('Beginner', store)).toBe(false);
    expect(loadCheckpoint('Beginner', store)).toBeNull();
    expect(loadAllCheckpoints(store)).toEqual([]);
  });

  it('records a pass and reads it back (Requirement 13.4)', () => {
    const rec = saveCheckpointPassed('Intermediate', 123, store);
    expect(rec).toEqual({ tier: 'Intermediate', passed: true, passedAt: 123 });
    expect(isCheckpointPassed('Intermediate', store)).toBe(true);
    expect(loadCheckpoint('Intermediate', store)).toEqual(rec);
  });

  it('keeps a record per tier', () => {
    saveCheckpointPassed('Beginner', 1, store);
    saveCheckpointPassed('Expert', 2, store);
    expect(isCheckpointPassed('Beginner', store)).toBe(true);
    expect(isCheckpointPassed('Expert', store)).toBe(true);
    expect(isCheckpointPassed('Intermediate', store)).toBe(false);
    expect(loadAllCheckpoints(store)).toHaveLength(2);
  });

  it('reads as empty on a corrupt store', () => {
    store.map.set(CHECKPOINTS_KEY, '{not json');
    expect(loadAllCheckpoints(store)).toEqual([]);
    expect(isCheckpointPassed('Beginner', store)).toBe(false);
  });

  it('ignores records with an unknown tier', () => {
    store.map.set(
      CHECKPOINTS_KEY,
      JSON.stringify({ Nope: { tier: 'Nope', passed: true, passedAt: 1 } }),
    );
    expect(loadAllCheckpoints(store)).toEqual([]);
  });

  it('overwrites an earlier record for the same tier', () => {
    saveCheckpointPassed('Beginner', 1, store);
    saveCheckpointPassed('Beginner', 5, store);
    expect(loadCheckpoint('Beginner', store)?.passedAt).toBe(5);
    expect(loadAllCheckpoints(store)).toHaveLength(1);
  });
});

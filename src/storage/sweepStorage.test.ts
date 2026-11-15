import { describe, it, expect } from 'vitest';
import {
  loadCompletedSweepDays,
  recordSweepCompletion,
  hasCompletedSweepDay,
  SWEEP_KEY,
  type StorageLike,
} from './sweepStorage';

function memoryStorage(initial?: Record<string, string>): StorageLike {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('sweepStorage', () => {
  it('reads an empty list from a fresh store', () => {
    expect(loadCompletedSweepDays(memoryStorage())).toEqual([]);
  });

  it('records and reads back completed Sweep_Days', () => {
    const store = memoryStorage();
    recordSweepCompletion('2024-03-10', store);
    recordSweepCompletion('2024-03-11', store);
    expect(loadCompletedSweepDays(store)).toEqual(['2024-03-10', '2024-03-11']);
  });

  it('is idempotent: recording the same day twice stores it once', () => {
    const store = memoryStorage();
    recordSweepCompletion('2024-03-10', store);
    recordSweepCompletion('2024-03-10', store);
    expect(loadCompletedSweepDays(store)).toEqual(['2024-03-10']);
  });

  it('ignores malformed day strings', () => {
    const store = memoryStorage();
    recordSweepCompletion('03/10/2024', store);
    recordSweepCompletion('not-a-day', store);
    expect(loadCompletedSweepDays(store)).toEqual([]);
  });

  it('hasCompletedSweepDay reflects stored days', () => {
    const store = memoryStorage();
    expect(hasCompletedSweepDay('2024-03-10', store)).toBe(false);
    recordSweepCompletion('2024-03-10', store);
    expect(hasCompletedSweepDay('2024-03-10', store)).toBe(true);
    expect(hasCompletedSweepDay('2024-03-11', store)).toBe(false);
  });

  it('reads an empty list from a corrupt store', () => {
    const store = memoryStorage({ [SWEEP_KEY]: 'not json' });
    expect(loadCompletedSweepDays(store)).toEqual([]);
  });

  it('filters non-string / malformed entries on read', () => {
    const store = memoryStorage({
      [SWEEP_KEY]: JSON.stringify(['2024-03-10', 42, 'bad', '2024-03-12']),
    });
    expect(loadCompletedSweepDays(store)).toEqual(['2024-03-10', '2024-03-12']);
  });
});

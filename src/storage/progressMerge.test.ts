import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  mergeProgress,
  mergeMilestones,
  type ProgressSnapshot,
  type MilestoneRecord,
  type GameResultLike,
  type CompletedSweepDay,
} from './progressMerge';

const EMPTY: ProgressSnapshot = {
  milestones: [],
  gameResults: [],
  completedSweepDays: [],
};

describe('mergeProgress — union correctness (Requirement 20.6)', () => {
  it('is the union of distinct records by id/key', () => {
    const local: ProgressSnapshot = {
      milestones: [{ id: 'm1', updatedAt: 1 }],
      gameResults: [{ id: 'g1', finishedAt: 1 }],
      completedSweepDays: [{ sweepDay: '2024-01-01', timeMs: 10 }],
    };
    const account: ProgressSnapshot = {
      milestones: [{ id: 'm2', updatedAt: 2 }],
      gameResults: [{ id: 'g2', finishedAt: 2 }],
      completedSweepDays: [{ sweepDay: '2024-01-02', timeMs: 20 }],
    };
    const merged = mergeProgress(local, account);
    expect(merged.milestones.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(merged.gameResults.map((r) => r.id)).toEqual(['g1', 'g2']);
    expect(merged.completedSweepDays.map((d) => d.sweepDay)).toEqual([
      '2024-01-01',
      '2024-01-02',
    ]);
  });

  it('de-duplicates records that share an id (keeps one)', () => {
    const local: ProgressSnapshot = {
      ...EMPTY,
      milestones: [{ id: 'm1', updatedAt: 5, source: 'local' }],
    };
    const account: ProgressSnapshot = {
      ...EMPTY,
      milestones: [{ id: 'm1', updatedAt: 9, source: 'account' }],
    };
    const merged = mergeProgress(local, account);
    expect(merged.milestones).toHaveLength(1);
    // Larger timestamp wins deterministically.
    expect(merged.milestones[0]!.source).toBe('account');
  });
});

// ---- Generators for property tests -----------------------------------------

const milestoneArb: fc.Arbitrary<MilestoneRecord> = fc.record({
  id: fc.constantFrom('m1', 'm2', 'm3', 'm4'),
  updatedAt: fc.integer({ min: 0, max: 100 }),
  payload: fc.string(),
});

const gameResultArb: fc.Arbitrary<GameResultLike> = fc.record({
  id: fc.constantFrom('g1', 'g2', 'g3', 'g4'),
  finishedAt: fc.integer({ min: 0, max: 100 }),
  outcome: fc.constantFrom('won', 'lost'),
});

const sweepDayArb: fc.Arbitrary<CompletedSweepDay> = fc.record({
  sweepDay: fc.constantFrom('2024-01-01', '2024-01-02', '2024-01-03'),
  timeMs: fc.integer({ min: 0, max: 100 }),
});

const snapshotArb: fc.Arbitrary<ProgressSnapshot> = fc.record({
  milestones: fc.array(milestoneArb, { maxLength: 6 }),
  gameResults: fc.array(gameResultArb, { maxLength: 6 }),
  completedSweepDays: fc.array(sweepDayArb, { maxLength: 6 }),
});

describe('mergeProgress — confluence and idempotence (Requirement 20.7)', () => {
  it('confluence: merging in either order gives the same result', () => {
    fc.assert(
      fc.property(snapshotArb, snapshotArb, (a, b) => {
        expect(mergeProgress(a, b)).toEqual(mergeProgress(b, a));
      }),
    );
  });

  it('idempotence: merging the same snapshot twice equals merging once', () => {
    fc.assert(
      fc.property(snapshotArb, snapshotArb, (a, b) => {
        const once = mergeProgress(a, b);
        const twice = mergeProgress(once, b);
        expect(twice).toEqual(once);
      }),
    );
  });

  it('idempotence: merging a snapshot with itself is the normalized snapshot', () => {
    fc.assert(
      fc.property(snapshotArb, (a) => {
        const self = mergeProgress(a, a);
        // Re-merging must not change anything further.
        expect(mergeProgress(self, self)).toEqual(self);
        // The union of a with itself has exactly the distinct ids of a.
        const ids = new Set(a.milestones.map((m) => m.id));
        expect(self.milestones).toHaveLength(ids.size);
      }),
    );
  });

  it('merging with empty is a no-op (up to normalization/order)', () => {
    fc.assert(
      fc.property(snapshotArb, (a) => {
        expect(mergeProgress(a, EMPTY)).toEqual(mergeProgress(EMPTY, a));
      }),
    );
  });
});

describe('mergeMilestones ordering', () => {
  it('returns records sorted by id, independent of input order', () => {
    const a = [{ id: 'm3', updatedAt: 1 }, { id: 'm1', updatedAt: 1 }];
    const b = [{ id: 'm2', updatedAt: 1 }];
    expect(mergeMilestones(a, b).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});

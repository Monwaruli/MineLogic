import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  sweepDayOf,
  previousSweepDay,
  currentStreak,
  longestStreak,
  msUntilNextSweepDay,
  type SweepDay,
} from './streak';

/** The epoch ms for a `YYYY-MM-DD` UTC day's midnight. */
function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** Shift a `YYYY-MM-DD` UTC day by `n` whole days. */
function shiftDay(day: string, n: number): SweepDay {
  return sweepDayOf(dayMs(day) + n * 24 * 60 * 60 * 1000);
}

describe('sweepDayOf', () => {
  it('maps an instant to its UTC calendar day', () => {
    expect(sweepDayOf(Date.parse('2024-03-10T00:00:00.000Z'))).toBe('2024-03-10');
    expect(sweepDayOf(Date.parse('2024-03-10T23:59:59.999Z'))).toBe('2024-03-10');
    expect(sweepDayOf(Date.parse('2024-03-11T00:00:00.000Z'))).toBe('2024-03-11');
  });
});

describe('previousSweepDay', () => {
  it('returns the UTC day before, crossing month and year boundaries', () => {
    expect(previousSweepDay('2024-03-10')).toBe('2024-03-09');
    expect(previousSweepDay('2024-03-01')).toBe('2024-02-29'); // leap year
    expect(previousSweepDay('2024-01-01')).toBe('2023-12-31');
  });
});

describe('currentStreak', () => {
  it('is zero when neither the current nor the previous day is completed', () => {
    expect(currentStreak(['2024-01-01'], '2024-03-10')).toBe(0);
    expect(currentStreak([], '2024-03-10')).toBe(0);
  });

  it('counts a run ending at the current day when it is completed', () => {
    const days = ['2024-03-08', '2024-03-09', '2024-03-10'];
    expect(currentStreak(days, '2024-03-10')).toBe(3);
  });

  it('counts a run ending at the previous day when the current day is not completed', () => {
    const days = ['2024-03-08', '2024-03-09'];
    expect(currentStreak(days, '2024-03-10')).toBe(2);
  });

  it('ignores completed days that do not reach back to the current window', () => {
    const days = ['2024-03-01', '2024-03-02', '2024-03-09', '2024-03-10'];
    expect(currentStreak(days, '2024-03-10')).toBe(2);
  });
});

describe('longestStreak', () => {
  it('is zero for an empty set', () => {
    expect(longestStreak([])).toBe(0);
  });

  it('finds the longest run of consecutive days', () => {
    const days = ['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-10', '2024-03-11'];
    expect(longestStreak(days)).toBe(3);
  });

  it('counts a lone day as a run of one', () => {
    expect(longestStreak(['2024-03-10'])).toBe(1);
  });

  it('de-duplicates repeated days', () => {
    expect(longestStreak(['2024-03-10', '2024-03-10', '2024-03-11'])).toBe(2);
  });
});

describe('msUntilNextSweepDay', () => {
  it('counts down to the next UTC midnight', () => {
    const t = Date.parse('2024-03-10T23:00:00.000Z');
    expect(msUntilNextSweepDay(t)).toBe(60 * 60 * 1000);
  });
});

// --- Property tests for Requirement 18.8 (streak properties) --------------

/**
 * Generate a base day and a set of completed days nearby, so the generator is
 * constrained to the input space that matters (days around the current day).
 */
const nearbyDaysArb = fc
  .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z') })
  .chain((base) => {
    const baseDay = sweepDayOf(base.getTime());
    // Offsets in a window around the base day.
    const offsets = fc.array(fc.integer({ min: -30, max: 0 }), { maxLength: 20 });
    return fc.record({
      currentDay: fc.constant(baseDay),
      offsets,
    });
  });

describe('Requirement 18.8 — streak properties (fast-check)', () => {
  it('adding the current day increases the streak by one when the previous day is present', () => {
    fc.assert(
      fc.property(nearbyDaysArb, ({ currentDay, offsets }) => {
        const prev = previousSweepDay(currentDay);
        // Build a completed set that ALWAYS contains the previous day and never
        // the current day, from the random nearby offsets.
        const base = new Set<SweepDay>();
        for (const off of offsets) {
          const day = shiftDay(currentDay, off);
          if (day !== currentDay) base.add(day);
        }
        base.add(prev); // ensure the previous day is present
        base.delete(currentDay); // ensure the current day is absent

        const before = currentStreak(base, currentDay);
        const after = currentStreak(new Set([...base, currentDay]), currentDay);
        // Validates: Requirements 18.8
        expect(after).toBe(before + 1);
      }),
    );
  });

  it('the streak is zero when neither the current nor the previous day is present', () => {
    fc.assert(
      fc.property(nearbyDaysArb, ({ currentDay, offsets }) => {
        const prev = previousSweepDay(currentDay);
        const set = new Set<SweepDay>();
        for (const off of offsets) {
          const day = shiftDay(currentDay, off);
          if (day !== currentDay && day !== prev) set.add(day);
        }
        // Validates: Requirements 18.8
        expect(currentStreak(set, currentDay)).toBe(0);
      }),
    );
  });

  it('the current streak never exceeds the longest streak', () => {
    fc.assert(
      fc.property(nearbyDaysArb, ({ currentDay, offsets }) => {
        const set = new Set<SweepDay>();
        for (const off of offsets) set.add(shiftDay(currentDay, off));
        // Validates: Requirements 18.7, 18.9
        expect(currentStreak(set, currentDay)).toBeLessThanOrEqual(longestStreak(set));
      }),
    );
  });
});

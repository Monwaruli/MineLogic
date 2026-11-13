/**
 * The Streak_Tracker (task 8.3, Requirement 18.7-18.9).
 *
 * The Daily_Streak is computed from only two things: the player's set of
 * completed Sweep_Days and the current Sweep_Day (Requirement 18.7). A
 * Sweep_Day is a UTC calendar day written as a `YYYY-MM-DD` string; the
 * "previous Sweep_Day" is the UTC calendar day immediately before another day.
 *
 * Current Daily_Streak (Requirement 18.8):
 *  - Count back from the current Sweep_Day over the set of completed days: if
 *    the current day is completed it counts, otherwise the streak counts the
 *    run of completed days ending at the previous Sweep_Day. In both cases the
 *    streak is the length of the unbroken run of completed days ending at the
 *    current day or at the previous day.
 *  - So for any set that contains the previous Sweep_Day, adding the current
 *    Sweep_Day increases the streak by exactly one; and for any set that
 *    contains neither the current nor the previous Sweep_Day, the streak is 0.
 *
 * Longest Daily_Streak (Requirement 18.9): the length of the longest run of
 * consecutive completed UTC days anywhere in the set.
 *
 * Pure: no React, DOM, or Supabase imports, so it runs in tests and tools.
 */

/** A Sweep_Day is a UTC calendar day as a `YYYY-MM-DD` string. */
export type SweepDay = string;

/** Matches a `YYYY-MM-DD` date string. */
const SWEEP_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Milliseconds in one UTC day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The Sweep_Day (UTC calendar day) for an epoch-ms instant, as `YYYY-MM-DD`.
 * Used to key a game attempt's start time to the day it started on (18.5).
 */
export function sweepDayOf(epochMs: number): SweepDay {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** Parse a `YYYY-MM-DD` Sweep_Day to the UTC-midnight epoch ms it names. */
function dayToEpoch(day: SweepDay): number {
  if (!SWEEP_DAY_PATTERN.test(day)) {
    throw new RangeError(`Invalid Sweep_Day (expected YYYY-MM-DD): ${day}`);
  }
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(ms)) {
    throw new RangeError(`Invalid Sweep_Day: ${day}`);
  }
  return ms;
}

/** The Sweep_Day immediately before `day` (one UTC calendar day earlier). */
export function previousSweepDay(day: SweepDay): SweepDay {
  return sweepDayOf(dayToEpoch(day) - MS_PER_DAY);
}

/** Normalize a set/list of days to a de-duplicated Set of valid Sweep_Days. */
function toDaySet(days: Iterable<SweepDay>): Set<SweepDay> {
  const set = new Set<SweepDay>();
  for (const day of days) {
    if (SWEEP_DAY_PATTERN.test(day)) set.add(day);
  }
  return set;
}

/**
 * The current Daily_Streak: the length of the unbroken run of completed days
 * ending at `currentDay` (if completed) or at the previous day (if the current
 * day is not yet completed). Computed from only the completed-day set and the
 * current day (Requirement 18.7).
 *
 * Counting from the previous day when the current day is not completed is what
 * makes the 18.8 property hold: a set with the previous day has a run of length
 * n ending at the previous day, so the streak is n; adding the current day
 * extends that same run to n + 1.
 */
export function currentStreak(
  completed: Iterable<SweepDay>,
  currentDay: SweepDay,
): number {
  const set = toDaySet(completed);
  // Count back from the current day if it is completed, otherwise from the day
  // before it. If neither the current nor the previous day is completed the run
  // is empty and the streak is zero.
  let cursor = set.has(currentDay) ? currentDay : previousSweepDay(currentDay);
  let streak = 0;
  while (set.has(cursor)) {
    streak++;
    cursor = previousSweepDay(cursor);
  }
  return streak;
}

/**
 * The longest Daily_Streak ever reached: the longest run of consecutive UTC
 * days present in the completed-day set (Requirement 18.9).
 */
export function longestStreak(completed: Iterable<SweepDay>): number {
  const set = toDaySet(completed);
  if (set.size === 0) return 0;
  // Sort by the UTC epoch so consecutive days are adjacent, then scan runs.
  const sorted = [...set].sort((a, b) => dayToEpoch(a) - dayToEpoch(b));
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gapDays = (dayToEpoch(sorted[i]) - dayToEpoch(sorted[i - 1])) / MS_PER_DAY;
    if (gapDays === 1) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

/** Milliseconds remaining until the next Sweep_Day begins (Requirement 18.10). */
export function msUntilNextSweepDay(epochMs: number): number {
  const today = dayToEpoch(sweepDayOf(epochMs));
  const nextMidnight = today + MS_PER_DAY;
  return nextMidnight - epochMs;
}

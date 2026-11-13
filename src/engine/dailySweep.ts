/**
 * Daily_Sweep board selection (task 8.3, Requirement 18.1 and 18.3).
 *
 * The Daily_Sweep gives the SAME Daily_Sweep_Board to every player during a
 * Sweep_Day (18.1). When no board is pre-assigned to the current Sweep_Day, the
 * board is chosen from a reserve pool of validated Daily_Sweep_Boards using the
 * Sweep_Day's date as the selection key (18.3), so the choice is deterministic:
 * the same UTC day always maps to the same board for every caller.
 *
 * This module owns only the determinism and the UTC-day keying. The reserve
 * pool itself (the validated Intermediate No_Guess_Boards of 18.2) is authored
 * content loaded elsewhere; here the pool is any non-empty array the caller
 * supplies, and selection is a pure function of the Sweep_Day string.
 *
 * Pure: no React, DOM, or Supabase imports.
 */

import type { SweepDay } from './streak';

/** A `YYYY-MM-DD` Sweep_Day string. */
const SWEEP_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A stable, well-mixed 32-bit hash of a Sweep_Day string (FNV-1a).
 *
 * Using a string hash keyed on the date (rather than, say, days-since-epoch
 * modulo pool size) spreads consecutive days across the pool so successive days
 * are unlikely to repeat the same board, while staying a pure function of the
 * date string.
 */
export function sweepDayHash(day: SweepDay): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < day.length; i++) {
    hash ^= day.charCodeAt(i);
    // FNV prime multiply, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The index into a reserve pool of `poolSize` boards for a given Sweep_Day.
 * Deterministic: the same day and pool size always give the same index.
 */
export function sweepBoardIndex(day: SweepDay, poolSize: number): number {
  if (!SWEEP_DAY_PATTERN.test(day)) {
    throw new RangeError(`Invalid Sweep_Day (expected YYYY-MM-DD): ${day}`);
  }
  if (!Number.isInteger(poolSize) || poolSize <= 0) {
    throw new RangeError(`Reserve pool must be non-empty, got size ${poolSize}`);
  }
  return sweepDayHash(day) % poolSize;
}

/**
 * Select the shared Daily_Sweep_Board for a Sweep_Day from a reserve pool.
 *
 * The result is a pure function of the Sweep_Day string and the pool contents,
 * so every player that calls this with the same day and pool receives the same
 * board (18.1). Throws on an empty pool, since there is nothing to deliver.
 */
export function selectSweepBoard<T>(day: SweepDay, pool: readonly T[]): T {
  if (pool.length === 0) {
    throw new RangeError('Cannot select a Daily Sweep board from an empty reserve pool.');
  }
  return pool[sweepBoardIndex(day, pool.length)];
}

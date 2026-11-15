/**
 * localStorage helper for completed Daily_Sweep days (Daily_Streak, Req 18.7-18.9).
 *
 * The Streak_Tracker (src/engine/streak.ts) computes the current and longest
 * Daily_Streak from just the set of completed Sweep_Days and today's Sweep_Day.
 * This helper is where those completed days are persisted on the device: when a
 * player clears the Daily_Sweep board for a day, we record that day's
 * `YYYY-MM-DD` Sweep_Day string. The streaks are then a pure function of this
 * set (local-only for Milestone 2; a backend sync can replace this later).
 *
 * Like the other storage helpers, reads never throw: a missing or corrupt store
 * reads as an empty set, and writes are best-effort (ignored on quota errors).
 */

import type { SweepDay } from '../engine/streak';

/** localStorage key for the completed-Sweep_Days list. */
export const SWEEP_KEY = 'minelogic.sweep.v1';

/** Matches a `YYYY-MM-DD` Sweep_Day string. */
const SWEEP_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A minimal Storage-like surface, so tests can pass an in-memory stub. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Resolve the Storage to use: the injected one, else window.localStorage. */
function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Accessing localStorage can throw in some sandboxed environments.
  }
  return null;
}

/** Read every completed Sweep_Day; empty when nothing stored or corrupt. */
export function loadCompletedSweepDays(storage?: StorageLike): SweepDay[] {
  const store = resolveStorage(storage);
  if (!store) return [];
  let raw: string | null;
  try {
    raw = store.getItem(SWEEP_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is SweepDay => typeof d === 'string' && SWEEP_DAY_PATTERN.test(d),
    );
  } catch {
    return [];
  }
}

/** True when `day` is already recorded as completed. */
export function hasCompletedSweepDay(day: SweepDay, storage?: StorageLike): boolean {
  return loadCompletedSweepDays(storage).includes(day);
}

/**
 * Record a completed Sweep_Day and persist it; returns the updated list. Idempotent
 * (a day already present is not duplicated) and never throws.
 */
export function recordSweepCompletion(day: SweepDay, storage?: StorageLike): SweepDay[] {
  if (!SWEEP_DAY_PATTERN.test(day)) return loadCompletedSweepDays(storage);
  const store = resolveStorage(storage);
  const existing = loadCompletedSweepDays(storage);
  if (existing.includes(day)) return existing;
  const updated = [...existing, day];
  if (store) {
    try {
      store.setItem(SWEEP_KEY, JSON.stringify(updated));
    } catch {
      // Ignore write failures (quota exceeded, storage disabled).
    }
  }
  return updated;
}

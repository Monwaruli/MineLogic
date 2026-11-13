/**
 * Typed localStorage helper for finished games (task 4.2 persistence).
 *
 * Each finished game is saved as a record that holds everything later tasks
 * (leaderboards, replay, study) need to recompute metrics from the same bytes:
 *  - the Board in canonical Board_Format text (via the Board_Printer),
 *  - the serialized Move_Log text (via the Move_Log serializer),
 *  - a cached copy of the Game_Metrics and the generator metadata,
 *  - the difficulty name and the epoch ms the game finished.
 *
 * Because the Board and Move_Log are stored as their canonical text, a later
 * task can parse them back and recompute metrics independently, so stored
 * results never drift from the engine (Requirement 9).
 *
 * The helper is defensive: it never throws on read. A missing or corrupt store
 * reads as an empty list, so a bad localStorage entry can never crash the app.
 */

import type { GameMetrics } from '../engine/metrics';

/** The localStorage key under which the results list lives. */
export const RESULTS_KEY = 'minelogic.results.v1';

/** One finished-game record. */
export interface GameResultRecord {
  /** Stable id for the record (board id plus finish time). */
  id: string;
  /** Difficulty preset name the game was played at. */
  difficulty: string;
  /** The Board in canonical Board_Format text. */
  boardText: string;
  /** The serialized Move_Log text. */
  moveLogText: string;
  /** Cached Game_Metrics (recomputable from boardText + moveLogText). */
  metrics: GameMetrics;
  /** Generator seed, when the board came from the generator. */
  seed?: number;
  /** Epoch ms when the game finished. */
  finishedAt: number;
}

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

/**
 * Read every saved result. Returns an empty array when nothing is stored or the
 * stored value is missing/corrupt; never throws.
 */
export function loadResults(storage?: StorageLike): GameResultRecord[] {
  const store = resolveStorage(storage);
  if (!store) return [];
  let raw: string | null;
  try {
    raw = store.getItem(RESULTS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Shallow shape check: keep only records that look well-formed.
    return parsed.filter(
      (r): r is GameResultRecord =>
        r &&
        typeof r.id === 'string' &&
        typeof r.boardText === 'string' &&
        typeof r.moveLogText === 'string' &&
        r.metrics != null,
    );
  } catch {
    return [];
  }
}

/**
 * Append a result and persist the list. Returns the updated list. A failure to
 * write (quota, disabled storage) is swallowed so finishing a game never
 * crashes the UI; the returned list still reflects the append in memory.
 */
export function saveResult(
  record: GameResultRecord,
  storage?: StorageLike,
): GameResultRecord[] {
  const store = resolveStorage(storage);
  const existing = loadResults(storage);
  const updated = [...existing, record];
  if (store) {
    try {
      store.setItem(RESULTS_KEY, JSON.stringify(updated));
    } catch {
      // Ignore write failures (quota exceeded, storage disabled).
    }
  }
  return updated;
}

/**
 * localStorage helper for completed Follow-Along Practice boards (task 5).
 *
 * When a learner clears a practice board, Requirement 14.11 asks us to record
 * the completion for that Difficulty. We store one record per completion with
 * the Difficulty, the counts shown at the end (intercepted actions and stage-2
 * Nudges), and the finish time, so later tasks (the Hub, leaderboard gating in
 * Assumption 7) can tell that a Difficulty has at least one completed practice
 * board.
 *
 * Like gameStorage, this helper never throws on read: a missing or corrupt
 * store reads as an empty list.
 */

/** localStorage key for the practice-completions list. */
export const PRACTICE_KEY = 'minelogic.practice.v1';

/** One completed-practice record. */
export interface PracticeCompletionRecord {
  /** Difficulty preset name the practice board was played at. */
  difficulty: string;
  /** Board identifier. */
  boardId: string;
  /** Number of intercepted Reveal_Actions during the session (14.11). */
  interceptedCount: number;
  /** Number of stage-2 Nudges reached during the session (14.11). */
  stage2Count: number;
  /** Epoch ms when the board was cleared. */
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

/** Read every completion record; empty when nothing stored or corrupt. */
export function loadPracticeCompletions(
  storage?: StorageLike,
): PracticeCompletionRecord[] {
  const store = resolveStorage(storage);
  if (!store) return [];
  let raw: string | null;
  try {
    raw = store.getItem(PRACTICE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is PracticeCompletionRecord =>
        r &&
        typeof r.difficulty === 'string' &&
        typeof r.boardId === 'string' &&
        typeof r.interceptedCount === 'number' &&
        typeof r.stage2Count === 'number',
    );
  } catch {
    return [];
  }
}

/** Append a completion and persist; returns the updated list. Never throws. */
export function savePracticeCompletion(
  record: PracticeCompletionRecord,
  storage?: StorageLike,
): PracticeCompletionRecord[] {
  const store = resolveStorage(storage);
  const existing = loadPracticeCompletions(storage);
  const updated = [...existing, record];
  if (store) {
    try {
      store.setItem(PRACTICE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore write failures (quota exceeded, storage disabled).
    }
  }
  return updated;
}

/** True when at least one practice board was completed at `difficulty`. */
export function hasCompletedPractice(
  difficulty: string,
  storage?: StorageLike,
): boolean {
  return loadPracticeCompletions(storage).some((r) => r.difficulty === difficulty);
}

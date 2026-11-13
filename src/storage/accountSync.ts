/**
 * Account sync orchestration (task 8.2).
 *
 * Ties the pure merge (progressMerge) and the Sync_Queue together for the
 * "first sign-in on this browser" flow (Requirement 20.6):
 *   1. The merge of local (Guest) progress into the Account must run exactly
 *      ONCE per browser per Account, so it is guarded by a local-storage flag
 *      keyed on the Account's user id. Running it again is a no-op even if the
 *      flag were missing, because the merge is idempotent (Requirement 20.7) and
 *      the Sync_Queue upserts are idempotent (Requirement 20.10) — the flag just
 *      avoids redundant work.
 *   2. Each merged record is enqueued as an idempotent upsert, so the Backend
 *      ends up holding the union of local and Account progress (20.6, 20.8).
 *
 * Pure-ish: it depends only on the merge module, the Sync_Queue, and an
 * injectable StorageLike, so it is testable without a real client. Guests never
 * call this, so offline play never touches the Backend (Requirement 20.1).
 */

import {
  mergeProgress,
  type ProgressSnapshot,
  type MilestoneRecord,
  type GameResultLike,
  type CompletedSweepDay,
} from './progressMerge';
import { enqueue, type SyncWrite, type StorageLike } from './syncQueue';

/** localStorage key prefix for the per-Account first-sign-in merge flag. */
export const MERGE_FLAG_PREFIX = 'minelogic.merged.v1.';

/** The flag key for a given Account user id. */
function mergeFlagKey(userId: string): string {
  return `${MERGE_FLAG_PREFIX}${userId}`;
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

/** True when the first-sign-in merge has already run for this Account here. */
export function hasMerged(userId: string, storage?: StorageLike): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    return store.getItem(mergeFlagKey(userId)) === '1';
  } catch {
    return false;
  }
}

/** Mark the first-sign-in merge as done for this Account here. Never throws. */
function markMerged(userId: string, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(mergeFlagKey(userId), '1');
  } catch {
    // Ignore write failures (quota exceeded, storage disabled).
  }
}

/** Build the Backend row + stable sync write for a milestone. */
function milestoneWrite(userId: string, m: MilestoneRecord): SyncWrite {
  return {
    id: `progress:${userId}:${m.id}`,
    table: 'progress',
    row: { user_id: userId, milestone_id: m.id, ...m },
    onConflict: 'user_id,difficulty',
    attempts: 0,
  };
}

/** Build the Backend row + stable sync write for a game result. */
function gameResultWrite(userId: string, r: GameResultLike): SyncWrite {
  return {
    id: `game_results:${userId}:${r.id}`,
    table: 'game_results',
    row: { ...r, user_id: userId },
    onConflict: 'id',
    attempts: 0,
  };
}

/** Build the Backend row + stable sync write for a completed Sweep_Day. */
function sweepDayWrite(userId: string, d: CompletedSweepDay): SyncWrite {
  return {
    id: `completed_sweep_days:${userId}:${d.sweepDay}`,
    table: 'completed_sweep_days',
    row: { user_id: userId, sweep_day: d.sweepDay, time_ms: d.timeMs },
    onConflict: 'user_id,sweep_day',
    attempts: 0,
  };
}

/** The result of a first-sign-in merge attempt. */
export interface MergeOnSignInResult {
  /** True when the merge actually ran (false when already merged here). */
  ran: boolean;
  /** The merged union snapshot (the Account's state going forward). */
  merged: ProgressSnapshot;
  /** Number of writes enqueued for the Backend. */
  enqueued: number;
}

/**
 * Merge the local (Guest) progress into the Account on the first sign-in on this
 * browser (Requirement 20.6), guarded so it runs at most once per Account here.
 *
 * On the first run it computes the union of the local and Account snapshots and
 * enqueues an idempotent upsert for every merged record, then sets the guard
 * flag. On later runs it returns the merged union (recomputed, still correct by
 * idempotence) without re-enqueueing.
 */
export function mergeProgressOnFirstSignIn(
  userId: string,
  local: ProgressSnapshot,
  account: ProgressSnapshot,
  storage?: StorageLike,
): MergeOnSignInResult {
  const merged = mergeProgress(local, account);

  if (hasMerged(userId, storage)) {
    return { ran: false, merged, enqueued: 0 };
  }

  let enqueued = 0;
  for (const m of merged.milestones) {
    enqueue(milestoneWrite(userId, m), storage);
    enqueued += 1;
  }
  for (const r of merged.gameResults) {
    enqueue(gameResultWrite(userId, r), storage);
    enqueued += 1;
  }
  for (const d of merged.completedSweepDays) {
    enqueue(sweepDayWrite(userId, d), storage);
    enqueued += 1;
  }

  markMerged(userId, storage);
  return { ran: true, merged, enqueued };
}

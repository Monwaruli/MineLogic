/**
 * Progress merge (task 8.2).
 *
 * When a Guest with local progress signs in on a browser for the first time,
 * their local progress is merged into the Account as the UNION of milestones,
 * game results, and completed Sweep_Days (Requirement 20.6).
 *
 * The merge is modeled as a set union keyed by stable record ids, which gives
 * us the two correctness properties the spec calls for:
 *   - Confluence (Requirement 20.7): merging local and Account progress in
 *     either order gives the same result. Set union is commutative over the set
 *     of ids, and this module resolves same-id collisions with a deterministic,
 *     order-independent rule, so merge(a, b) and merge(b, a) agree.
 *   - Idempotence (Requirement 20.7): merging the same records twice leaves the
 *     result unchanged. Union with an already-included id is a no-op.
 *
 * This is pure logic with no storage or Supabase imports, so it is trivially
 * testable (including with fast-check). The UI/sync layer feeds it the local and
 * Account snapshots and ships the result to the Backend through the Sync_Queue.
 */

/** A milestone record (e.g. a completed lesson or a passed checkpoint). */
export interface MilestoneRecord {
  /** Stable id, unique per milestone (e.g. `${tier}:${kind}:${ref}`). */
  id: string;
  /** Epoch ms the milestone was recorded; used only to break id collisions. */
  updatedAt: number;
  /** Opaque payload the app recomputes from; merged by id, not inspected. */
  [key: string]: unknown;
}

/** A finished-game record keyed by its stable id (mirrors GameResultRecord.id). */
export interface GameResultLike {
  /** Stable id (board id plus finish time in gameStorage). */
  id: string;
  /** Epoch ms the game finished; used only to break id collisions. */
  finishedAt: number;
  [key: string]: unknown;
}

/** A completed Sweep_Day keyed by its UTC calendar day (YYYY-MM-DD). */
export interface CompletedSweepDay {
  /** Stable key: the UTC calendar day, e.g. "2024-01-02". */
  sweepDay: string;
  /** Completion time in ms; used only to break key collisions. */
  timeMs: number;
  [key: string]: unknown;
}

/** A full progress snapshot: the three record kinds that are merged. */
export interface ProgressSnapshot {
  milestones: MilestoneRecord[];
  gameResults: GameResultLike[];
  completedSweepDays: CompletedSweepDay[];
}

/**
 * Merge two record lists by a stable key into the union of both.
 *
 * - Output ids are the union of the two inputs' keys.
 * - When both inputs carry a record for the same key, `pick` chooses the
 *   survivor. `pick` MUST be commutative (pick(x, y) deep-equals pick(y, x)) so
 *   that the overall merge is order-independent.
 * - Output order is deterministic: ascending by key, independent of input order.
 */
function mergeByKey<T>(
  a: readonly T[],
  b: readonly T[],
  keyOf: (item: T) => string,
  pick: (x: T, y: T) => T,
): T[] {
  const byKey = new Map<string, T>();
  // Fold EVERY item (from both lists) through `pick`, including the first time
  // a key is seen. This matters when a single input list itself contains two
  // records with the same key: without applying `pick` to the first occurrence,
  // the surviving record would depend on that list's internal order, which
  // would break commutativity (merge(a, b) != merge(b, a)). Because `pick` is
  // commutative and associative over same-key records, collapsing each key with
  // it is order-independent across and within the inputs.
  for (const item of [...a, ...b]) {
    const key = keyOf(item);
    const existing = byKey.get(key);
    byKey.set(key, existing === undefined ? item : pick(existing, item));
  }
  return [...byKey.keys()].sort().map((key) => byKey.get(key)!);
}

/**
 * A commutative tie-break for same-id records: keep the one with the larger
 * timestamp, and on an exact timestamp tie fall back to the lexicographically
 * larger JSON serialization. Both rules are symmetric, so the choice does not
 * depend on argument order.
 */
function pickByTimestamp<T extends Record<string, unknown>>(
  tsOf: (item: T) => number,
): (x: T, y: T) => T {
  return (x, y) => {
    const tx = tsOf(x);
    const ty = tsOf(y);
    if (tx > ty) return x;
    if (ty > tx) return y;
    // Timestamps equal: pick deterministically by serialized content.
    return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
  };
}

/** Merge milestone lists into their union, keyed by `id` (Requirement 20.6). */
export function mergeMilestones(
  a: readonly MilestoneRecord[],
  b: readonly MilestoneRecord[],
): MilestoneRecord[] {
  return mergeByKey(
    a,
    b,
    (m) => m.id,
    pickByTimestamp((m) => m.updatedAt),
  );
}

/** Merge game-result lists into their union, keyed by `id` (Requirement 20.6). */
export function mergeGameResults(
  a: readonly GameResultLike[],
  b: readonly GameResultLike[],
): GameResultLike[] {
  return mergeByKey(
    a,
    b,
    (r) => r.id,
    pickByTimestamp((r) => r.finishedAt),
  );
}

/** Merge completed-Sweep_Day lists into their union, keyed by `sweepDay`. */
export function mergeCompletedSweepDays(
  a: readonly CompletedSweepDay[],
  b: readonly CompletedSweepDay[],
): CompletedSweepDay[] {
  return mergeByKey(
    a,
    b,
    (d) => d.sweepDay,
    pickByTimestamp((d) => d.timeMs),
  );
}

/**
 * Merge two full progress snapshots into their union (Requirement 20.6).
 *
 * Commutative (20.7): `mergeProgress(x, y)` deep-equals `mergeProgress(y, x)`.
 * Idempotent (20.7): `mergeProgress(x, x)` deep-equals the normalized `x`, and
 * `mergeProgress(mergeProgress(x, y), y)` deep-equals `mergeProgress(x, y)`.
 */
export function mergeProgress(
  local: ProgressSnapshot,
  account: ProgressSnapshot,
): ProgressSnapshot {
  return {
    milestones: mergeMilestones(local.milestones, account.milestones),
    gameResults: mergeGameResults(local.gameResults, account.gameResults),
    completedSweepDays: mergeCompletedSweepDays(
      local.completedSweepDays,
      account.completedSweepDays,
    ),
  };
}

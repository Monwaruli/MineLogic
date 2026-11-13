/**
 * Sync_Queue (task 8.2).
 *
 * While signed in, the app stores milestones, game results, and completed
 * Sweep_Days in the Backend (Requirement 20.8). When a Backend write fails, the
 * Sync_Queue keeps the write in local storage and retries it with increasing
 * (backoff) delays until it succeeds (Requirement 20.9).
 *
 * Every queued write carries a stable id and targets a table with a stable key,
 * and is delivered as an idempotent upsert (onConflict on that key). Delivering
 * the same write more than once therefore leaves the Backend in the same state
 * as delivering it once (Requirement 20.10): the first delivery inserts, later
 * deliveries update the same row to the same values.
 *
 * The queue is persisted like the other storage helpers (versioned key,
 * injectable StorageLike, never throws on read). The `deliver` function (which
 * performs the actual Backend upsert) and a `sleep` function are injected, so
 * tests drive retries without real timers or a real client, and guests never
 * construct a queue so offline play never touches the Backend.
 */

/** localStorage key for the pending-writes queue. */
export const SYNC_QUEUE_KEY = 'minelogic.syncqueue.v1';

/**
 * The Backend tables a write can target.
 *
 * Most targets are stable-keyed, upsertable tables delivered as idempotent
 * upserts (progress / game_results / completed_sweep_days). 'study_records' is
 * special: a Study_Record is written through the `insert_study_record` RPC, not
 * a direct table upsert (Requirement 25.10 routes every Study_Record through the
 * Sync_Queue). The queue stays table-agnostic about delivery — the injected
 * DeliverFn decides how to deliver each write — so 'study_records' rows carry a
 * STABLE id (so re-delivery is idempotent) and the study deliver path calls the
 * RPC rather than an upsert. See src/study/studyLogger.ts.
 */
export type SyncTable =
  | 'progress'
  | 'game_results'
  | 'completed_sweep_days'
  | 'study_records';

/** One pending Backend write. */
export interface SyncWrite {
  /** Stable id for the write, so re-enqueue/re-delivery is de-duplicated. */
  id: string;
  /** Target table. */
  table: SyncTable;
  /** The row to upsert. Must include the table's stable key column(s). */
  row: Record<string, unknown>;
  /** The conflict-target column(s) for the idempotent upsert (onConflict). */
  onConflict: string;
  /** Number of delivery attempts made so far (0 until first try). */
  attempts: number;
}

/** A minimal Storage-like surface, so tests can pass an in-memory stub. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Outcome of a single delivery attempt. */
export interface DeliverResult {
  ok: boolean;
  /** A message when the attempt failed (for logging). */
  error?: string;
}

/** Performs the actual idempotent upsert against the Backend. */
export type DeliverFn = (write: SyncWrite) => Promise<DeliverResult>;

/** Sleep for `ms`, injected so tests can run without real delays. */
export type SleepFn = (ms: number) => Promise<void>;

/** Backoff configuration for retries (Requirement 20.9). */
export interface BackoffOptions {
  /** Delay before the first retry, in ms. */
  baseMs: number;
  /** Multiplier applied to the delay after each failed attempt. */
  factor: number;
  /** Upper bound on any single delay, in ms. */
  maxMs: number;
  /** Max attempts per flush pass before giving up (keeps the write queued). */
  maxAttempts: number;
}

/** Sensible defaults: 500ms, doubling, capped at 30s, up to 8 tries per flush. */
export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 500,
  factor: 2,
  maxMs: 30_000,
  maxAttempts: 8,
};

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

/** The delay (ms) before the retry following `attempts` failed attempts. */
export function backoffDelay(attempts: number, opts: BackoffOptions): number {
  const raw = opts.baseMs * Math.pow(opts.factor, Math.max(0, attempts));
  return Math.min(raw, opts.maxMs);
}

/** Read the queued writes; empty when nothing stored or corrupt. Never throws. */
export function loadQueue(storage?: StorageLike): SyncWrite[] {
  const store = resolveStorage(storage);
  if (!store) return [];
  let raw: string | null;
  try {
    raw = store.getItem(SYNC_QUEUE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (w): w is SyncWrite =>
        w &&
        typeof w.id === 'string' &&
        (w.table === 'progress' ||
          w.table === 'game_results' ||
          w.table === 'completed_sweep_days' ||
          w.table === 'study_records') &&
        w.row != null &&
        typeof w.row === 'object' &&
        typeof w.onConflict === 'string' &&
        typeof w.attempts === 'number',
    );
  } catch {
    return [];
  }
}

/** Persist the queue. Never throws on write. */
function saveQueue(queue: SyncWrite[], storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Ignore write failures (quota exceeded, storage disabled).
  }
}

/**
 * Enqueue a write, keyed by its stable id. Re-enqueueing the same id replaces
 * the pending entry (so a newer value wins) rather than duplicating it, which
 * keeps the queue idempotent at enqueue time too. Returns the updated queue.
 */
export function enqueue(
  write: Omit<SyncWrite, 'attempts'> & { attempts?: number },
  storage?: StorageLike,
): SyncWrite[] {
  const queue = loadQueue(storage);
  const entry: SyncWrite = { attempts: 0, ...write };
  const idx = queue.findIndex((w) => w.id === entry.id);
  if (idx >= 0) {
    queue[idx] = { ...entry, attempts: queue[idx]!.attempts };
  } else {
    queue.push(entry);
  }
  saveQueue(queue, storage);
  return queue;
}

/** Summary of a flush pass. */
export interface FlushSummary {
  /** Writes delivered successfully and removed from the queue. */
  delivered: number;
  /** Writes still pending (delivery failed and they stay queued, 20.9). */
  remaining: number;
}

/**
 * Attempt to deliver every queued write, retrying failures with increasing
 * backoff delays (Requirement 20.9). A write that keeps failing is RETAINED in
 * local storage so a later flush can retry it — the queue is never dropped on
 * failure.
 *
 * Each write is delivered as an idempotent upsert via `deliver`, so delivering
 * the same write more than once is safe (Requirement 20.10).
 */
export async function flushQueue(
  deliver: DeliverFn,
  options: {
    storage?: StorageLike;
    backoff?: BackoffOptions;
    sleep?: SleepFn;
  } = {},
): Promise<FlushSummary> {
  const storage = options.storage;
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let queue = loadQueue(storage);
  let delivered = 0;
  const stillPending: SyncWrite[] = [];

  for (const write of queue) {
    let current = write;
    let success = false;

    while (current.attempts < backoff.maxAttempts) {
      const result = await deliver(current);
      current = { ...current, attempts: current.attempts + 1 };
      if (result.ok) {
        success = true;
        break;
      }
      // Failed: wait the backoff delay before the next attempt, unless this was
      // the last allowed attempt in this flush pass.
      if (current.attempts < backoff.maxAttempts) {
        await sleep(backoffDelay(current.attempts, backoff));
      }
    }

    if (success) {
      delivered += 1;
    } else {
      // Keep the write (with its attempt count) for a future flush (20.9).
      stillPending.push(current);
    }
  }

  queue = stillPending;
  saveQueue(queue, storage);
  return { delivered, remaining: queue.length };
}

/** Clear the queue (e.g. on sign-out). Never throws. */
export function clearQueue(storage?: StorageLike): void {
  saveQueue([], storage);
}

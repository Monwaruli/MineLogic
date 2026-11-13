/**
 * localStorage helper for Mastery_Checkpoint results (task 7.2).
 *
 * When a learner passes a Difficulty's Mastery_Checkpoint (three unassisted
 * Checkpoint_Variations in a row with no Slip), Requirement 13.4 asks us to
 * record the checkpoint as passed for that Difficulty. Later tasks (the Hub,
 * Mastery_Bars) read these records.
 *
 * One record per Difficulty, keyed by tier name, holds a `passed` flag and the
 * time it was passed. Like the other storage helpers, reads never throw: a
 * missing or corrupt store reads as "not passed".
 */

import type { Tier } from '../content/lessons';

/** localStorage key for the checkpoint-results map. */
export const CHECKPOINTS_KEY = 'minelogic.checkpoints.v1';

/** The result of one Difficulty's Mastery_Checkpoint. */
export interface CheckpointRecord {
  /** The tier (Difficulty) this checkpoint belongs to. */
  tier: Tier;
  /** True once the checkpoint was passed (Requirement 13.4). */
  passed: boolean;
  /** Epoch ms when the checkpoint was passed, or 0 when never. */
  passedAt: number;
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

/** The stored map, keyed by tier name. Empty when nothing stored or corrupt. */
function loadMap(storage?: StorageLike): Record<string, CheckpointRecord> {
  const store = resolveStorage(storage);
  if (!store) return {};
  let raw: string | null;
  try {
    raw = store.getItem(CHECKPOINTS_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, CheckpointRecord> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const r = value as Partial<CheckpointRecord>;
      if (
        r &&
        (r.tier === 'Beginner' || r.tier === 'Intermediate' || r.tier === 'Expert') &&
        typeof r.passed === 'boolean'
      ) {
        out[key] = {
          tier: r.tier,
          passed: r.passed,
          passedAt: typeof r.passedAt === 'number' ? r.passedAt : 0,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** The checkpoint record for one tier, or null when none is stored. */
export function loadCheckpoint(
  tier: Tier,
  storage?: StorageLike,
): CheckpointRecord | null {
  return loadMap(storage)[tier] ?? null;
}

/** Every stored checkpoint record. */
export function loadAllCheckpoints(storage?: StorageLike): CheckpointRecord[] {
  return Object.values(loadMap(storage));
}

/**
 * Record a tier's Mastery_Checkpoint as passed (Requirement 13.4). Returns the
 * saved record. Never throws on write.
 */
export function saveCheckpointPassed(
  tier: Tier,
  now: number = Date.now(),
  storage?: StorageLike,
): CheckpointRecord {
  const store = resolveStorage(storage);
  const map = loadMap(storage);
  const record: CheckpointRecord = { tier, passed: true, passedAt: now };
  map[tier] = record;
  if (store) {
    try {
      store.setItem(CHECKPOINTS_KEY, JSON.stringify(map));
    } catch {
      // Ignore write failures (quota exceeded, storage disabled).
    }
  }
  return record;
}

/** True when the tier's Mastery_Checkpoint is recorded passed (13.4). */
export function isCheckpointPassed(tier: Tier, storage?: StorageLike): boolean {
  return loadCheckpoint(tier, storage)?.passed ?? false;
}

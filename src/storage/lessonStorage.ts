/**
 * localStorage helper for Lesson progress (task 7.1).
 *
 * The Tutorial_Player records how far a learner got in each Lesson, so that
 * completing the last Do_Step marks the Lesson complete (Requirement 11.9) and
 * reopening a partly done Lesson resumes at the first incomplete Do_Step
 * (Requirement 11.10). Later tasks (the Hub, Mastery_Bars) read these records.
 *
 * One record per Lesson, keyed by Lesson id, holds the count of completed
 * Do_Steps and a `completed` flag. Like the other storage helpers, reads never
 * throw: a missing or corrupt store reads as "no progress".
 */

/** localStorage key for the Lesson-progress map. */
export const LESSONS_KEY = 'minelogic.lessons.v1';

/** Progress for one Lesson. */
export interface LessonProgress {
  /** Lesson id. */
  lessonId: string;
  /** Number of Do_Steps completed (0-based resume point). */
  completedDoSteps: number;
  /** True once the last Do_Step is completed (Requirement 11.9). */
  completed: boolean;
  /** Epoch ms of the last update. */
  updatedAt: number;
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

/** The stored map, keyed by Lesson id. Empty when nothing stored or corrupt. */
function loadMap(storage?: StorageLike): Record<string, LessonProgress> {
  const store = resolveStorage(storage);
  if (!store) return {};
  let raw: string | null;
  try {
    raw = store.getItem(LESSONS_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, LessonProgress> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const p = value as Partial<LessonProgress>;
      if (
        p &&
        typeof p.lessonId === 'string' &&
        typeof p.completedDoSteps === 'number' &&
        typeof p.completed === 'boolean'
      ) {
        out[key] = {
          lessonId: p.lessonId,
          completedDoSteps: p.completedDoSteps,
          completed: p.completed,
          updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Progress for one Lesson, or null when none is stored. */
export function loadLessonProgress(
  lessonId: string,
  storage?: StorageLike,
): LessonProgress | null {
  return loadMap(storage)[lessonId] ?? null;
}

/** Every stored Lesson progress record. */
export function loadAllLessonProgress(storage?: StorageLike): LessonProgress[] {
  return Object.values(loadMap(storage));
}

/**
 * The resume point for a Lesson: the index of the first incomplete Do_Step
 * (Requirement 11.10). Zero when nothing is stored; `doStepCount` when the
 * Lesson is already complete.
 */
export function resumeDoStepIndex(
  lessonId: string,
  doStepCount: number,
  storage?: StorageLike,
): number {
  const p = loadLessonProgress(lessonId, storage);
  if (!p) return 0;
  if (p.completed) return doStepCount;
  return Math.min(p.completedDoSteps, Math.max(0, doStepCount - 1));
}

/**
 * Record that `completedDoSteps` Do_Steps of a Lesson are done. The Lesson is
 * marked complete when that count reaches `doStepCount` (Requirement 11.9).
 * Returns the saved record. Never throws on write.
 */
export function saveLessonProgress(
  lessonId: string,
  completedDoSteps: number,
  doStepCount: number,
  now: number = Date.now(),
  storage?: StorageLike,
): LessonProgress {
  const store = resolveStorage(storage);
  const map = loadMap(storage);
  const clamped = Math.max(0, Math.min(completedDoSteps, doStepCount));
  const record: LessonProgress = {
    lessonId,
    completedDoSteps: clamped,
    completed: clamped >= doStepCount && doStepCount > 0,
    updatedAt: now,
  };
  map[lessonId] = record;
  if (store) {
    try {
      store.setItem(LESSONS_KEY, JSON.stringify(map));
    } catch {
      // Ignore write failures (quota exceeded, storage disabled).
    }
  }
  return record;
}

/** True when the Lesson is recorded complete (Requirement 11.9). */
export function isLessonComplete(lessonId: string, storage?: StorageLike): boolean {
  return loadLessonProgress(lessonId, storage)?.completed ?? false;
}

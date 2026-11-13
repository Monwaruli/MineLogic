/**
 * Local Study_Session pointer (task 9.1, Requirement 21.9).
 *
 * When a Participant reopens the Study_Link in the SAME browser, the study
 * module must resume the Study_Session at the first incomplete step (21.9).
 * That needs a local pointer tying this browser to a Participant_ID and the
 * steps completed so far. This helper persists that pointer, following the same
 * conventions as the other storage helpers (src/storage/*):
 *   - a versioned localStorage key,
 *   - an injectable StorageLike so tests pass an in-memory stub,
 *   - reads that NEVER throw (a missing/corrupt store reads as "no session").
 *
 * The pointer is scoped by Study_Code so two different studies opened in the
 * same browser do not collide. It records only the Participant_ID and the set
 * of completed steps — no consent text, no survey answers (those are Backend
 * Study_Records, written in 9.3). Clearing the pointer (on withdrawal or
 * decline) removes this browser's link to the identity.
 */

import { STUDY_STEPS, isStudyStep, type StudyStep } from './steps';

/** Versioned localStorage key for the local Study_Session pointer. */
export const STUDY_SESSION_KEY = 'minelogic.study.session.v1';

/** A minimal Storage-like surface so tests can pass an in-memory stub. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The persisted pointer for one Study_Code in this browser. */
export interface StudySessionPointer {
  /** The Study_Code whose session this pointer belongs to. */
  studyCode: string;
  /** The anonymous Participant_ID (uuid) created at consent (21.4). */
  participantId: string;
  /** The Resume_Code shown to the Participant (21.8), kept for re-display. */
  resumeCode: string;
  /** The steps completed so far, used to resume at the first incomplete one. */
  completedSteps: StudyStep[];
  /** Epoch ms of the last update. */
  updatedAt: number;
}

/** Resolve the Storage to use: the injected one, else window.localStorage. */
function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    if (typeof localStorage !== 'undefined') return localStorage as StorageLike;
  } catch {
    // Accessing localStorage can throw in some sandboxed environments.
  }
  return null;
}

/** The stored map is keyed by Study_Code so distinct studies do not collide. */
type PointerMap = Record<string, StudySessionPointer>;

function sanitizeSteps(value: unknown): StudyStep[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<StudyStep>();
  for (const v of value) {
    if (isStudyStep(v)) seen.add(v);
  }
  // Return in canonical order (22.1) for stable, deterministic output.
  return STUDY_STEPS.filter((s) => seen.has(s));
}

/** Read the whole pointer map, or an empty map on miss/corruption. */
function loadMap(store: StorageLike): PointerMap {
  let raw: string | null;
  try {
    raw = store.getItem(STUDY_SESSION_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: PointerMap = {};
    for (const [code, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Partial<StudySessionPointer>;
      if (typeof v.participantId !== 'string' || typeof v.resumeCode !== 'string') continue;
      out[code] = {
        studyCode: code,
        participantId: v.participantId,
        resumeCode: v.resumeCode,
        completedSteps: sanitizeSteps(v.completedSteps),
        updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the pointer map. Never throws on write. */
function saveMap(store: StorageLike, map: PointerMap): void {
  try {
    store.setItem(STUDY_SESSION_KEY, JSON.stringify(map));
  } catch {
    // Ignore write failures (quota exceeded, storage disabled).
  }
}

/**
 * Read the local Study_Session pointer for a Study_Code, or null when this
 * browser has no session for it (21.9). Never throws.
 */
export function loadStudySession(
  studyCode: string,
  storage?: StorageLike,
): StudySessionPointer | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  return loadMap(store)[studyCode] ?? null;
}

/**
 * Persist (create or replace) the local pointer for a Study_Code. Called after
 * a Participant is created (21.4) and whenever a step completes, so a
 * same-browser reopen resumes at the first incomplete step (21.9).
 */
export function saveStudySession(
  pointer: Omit<StudySessionPointer, 'updatedAt'>,
  now: number = Date.now(),
  storage?: StorageLike,
): StudySessionPointer {
  const record: StudySessionPointer = {
    ...pointer,
    completedSteps: sanitizeSteps(pointer.completedSteps),
    updatedAt: now,
  };
  const store = resolveStorage(storage);
  if (store) {
    const map = loadMap(store);
    map[pointer.studyCode] = record;
    saveMap(store, map);
  }
  return record;
}

/**
 * Mark a step complete for the current Study_Session and persist. A no-op when
 * no pointer exists for the Study_Code. Returns the updated pointer or null.
 */
export function markStepComplete(
  studyCode: string,
  step: StudyStep,
  now: number = Date.now(),
  storage?: StorageLike,
): StudySessionPointer | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  const map = loadMap(store);
  const existing = map[studyCode];
  if (!existing) return null;
  const completed = new Set<StudyStep>(existing.completedSteps);
  completed.add(step);
  const updated: StudySessionPointer = {
    ...existing,
    completedSteps: STUDY_STEPS.filter((s) => completed.has(s)),
    updatedAt: now,
  };
  map[studyCode] = updated;
  saveMap(store, map);
  return updated;
}

/** Versioned key for the "a test game is in progress" marker (22.12). */
export const STUDY_TEST_MARKER_KEY = 'minelogic.study.testInProgress.v1';

/**
 * A marker that a Pre_Test / Post_Test game is underway (22.12). It is written
 * the moment a test game screen mounts and cleared when the game ends normally.
 * If the page is reloaded or closed mid-game, the marker survives; on the next
 * load the Study_Module sees it and records the game Interrupted, then resumes
 * at the next step. The marker is keyed by Study_Code so two studies in one
 * browser do not collide.
 */
export interface StudyTestMarker {
  studyCode: string;
  /** The Study_Session step whose test game is in progress. */
  step: StudyStep;
  /** The Difficulty of the test game, for the Interrupted record. */
  tier: string;
  /** The Evaluation_Board identifier, for the Interrupted record. */
  boardId: string;
  /** Which test (0-based) within the phase this is (Beginner=0, …). */
  gameIndex: number;
  updatedAt: number;
}

type TestMarkerMap = Record<string, StudyTestMarker>;

function loadMarkerMap(store: StorageLike): TestMarkerMap {
  let raw: string | null;
  try {
    raw = store.getItem(STUDY_TEST_MARKER_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: TestMarkerMap = {};
    for (const [code, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Partial<StudyTestMarker>;
      if (!isStudyStep(v.step)) continue;
      if (typeof v.tier !== 'string' || typeof v.boardId !== 'string') continue;
      out[code] = {
        studyCode: code,
        step: v.step,
        tier: v.tier,
        boardId: v.boardId,
        gameIndex: typeof v.gameIndex === 'number' ? v.gameIndex : 0,
        updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function saveMarkerMap(store: StorageLike, map: TestMarkerMap): void {
  try {
    store.setItem(STUDY_TEST_MARKER_KEY, JSON.stringify(map));
  } catch {
    // Ignore write failures.
  }
}

/** Read the in-progress test marker for a Study_Code, or null when none (22.12). */
export function loadTestMarker(
  studyCode: string,
  storage?: StorageLike,
): StudyTestMarker | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  return loadMarkerMap(store)[studyCode] ?? null;
}

/** Write the in-progress test marker for a Study_Code (22.12). */
export function saveTestMarker(
  marker: Omit<StudyTestMarker, 'updatedAt'>,
  now: number = Date.now(),
  storage?: StorageLike,
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  const map = loadMarkerMap(store);
  map[marker.studyCode] = { ...marker, updatedAt: now };
  saveMarkerMap(store, map);
}

/** Clear the in-progress test marker for a Study_Code (game ended normally). */
export function clearTestMarker(studyCode: string, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store) return;
  const map = loadMarkerMap(store);
  if (studyCode in map) {
    delete map[studyCode];
    saveMarkerMap(store, map);
  }
}

/**
 * Clear this browser's pointer for a Study_Code (on withdrawal or decline so
 * the browser no longer links to the identity). Never throws.
 */
export function clearStudySession(studyCode: string, storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store) return;
  const map = loadMap(store);
  if (studyCode in map) {
    delete map[studyCode];
    saveMap(store, map);
  }
  // Also drop any in-progress test marker for this study.
  const markers = loadMarkerMap(store);
  if (studyCode in markers) {
    delete markers[studyCode];
    saveMarkerMap(store, markers);
  }
}

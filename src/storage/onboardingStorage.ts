/**
 * localStorage helper for Onboarding_Flow results (task 7.3).
 *
 * On first visit the Onboarding_Flow asks the two Background_Questions (prior
 * Minesweeper experience and input device) and then runs the Skill_Check of
 * three Skill_Check_Snippets, one per Difficulty (Requirement 10.1, 10.2). This
 * helper persists:
 *   - the two Background_Question answers,
 *   - each snippet's recorded result (Correct / Trap / Other, Requirement 10.4),
 *   - whether onboarding was completed or skipped (Requirement 10.6, 10.7).
 *
 * The Progress_Service reads the per-tier Skill_Check results to initialize the
 * Mastery_Bars (Requirement 10.6, 17.2). Like the other storage helpers, reads
 * never throw: a missing or corrupt store reads as "not onboarded".
 */

import type { Tier } from '../content/lessons';

/** localStorage key for the onboarding record. */
export const ONBOARDING_KEY = 'minelogic.onboarding.v1';

/** Prior-experience answer options (Requirement 10.2). */
export type ExperienceAnswer = 'new' | 'casual' | 'regular';

/** Input-device answer options (Requirement 10.2). */
export type InputDeviceAnswer = 'mouse' | 'trackpad' | 'other';

/** A single Skill_Check_Snippet result (Requirement 10.4). */
export type SkillCheckResult = 'Correct' | 'Trap' | 'Other';

/** The persisted Onboarding_Flow record. */
export interface OnboardingRecord {
  /** True once onboarding ran to the end or was skipped (10.6, 10.7). */
  completed: boolean;
  /** True when the learner chose Skip (10.7). */
  skipped: boolean;
  /** Prior-experience answer, or null when skipped before answering. */
  experience: ExperienceAnswer | null;
  /** Input-device answer, or null when skipped before answering. */
  inputDevice: InputDeviceAnswer | null;
  /** Per-tier Skill_Check result; a tier is absent when not answered. */
  skillCheck: Partial<Record<Tier, SkillCheckResult>>;
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

const TIERS: Tier[] = ['Beginner', 'Intermediate', 'Expert'];

function isExperience(v: unknown): v is ExperienceAnswer {
  return v === 'new' || v === 'casual' || v === 'regular';
}

function isInputDevice(v: unknown): v is InputDeviceAnswer {
  return v === 'mouse' || v === 'trackpad' || v === 'other';
}

function isResult(v: unknown): v is SkillCheckResult {
  return v === 'Correct' || v === 'Trap' || v === 'Other';
}

/** Read the onboarding record, or null when nothing is stored or it is corrupt. */
export function loadOnboarding(storage?: StorageLike): OnboardingRecord | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(ONBOARDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingRecord>;
    if (!parsed || typeof parsed !== 'object') return null;
    const skillCheck: Partial<Record<Tier, SkillCheckResult>> = {};
    const rawSkill = (parsed.skillCheck ?? {}) as Record<string, unknown>;
    for (const tier of TIERS) {
      const r = rawSkill[tier];
      if (isResult(r)) skillCheck[tier] = r;
    }
    return {
      completed: parsed.completed === true,
      skipped: parsed.skipped === true,
      experience: isExperience(parsed.experience) ? parsed.experience : null,
      inputDevice: isInputDevice(parsed.inputDevice) ? parsed.inputDevice : null,
      skillCheck,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

/** True when onboarding has been completed or skipped (so it should not re-show). */
export function hasOnboarded(storage?: StorageLike): boolean {
  return loadOnboarding(storage)?.completed ?? false;
}

/** Persist an onboarding record. Never throws on write. */
export function saveOnboarding(
  record: OnboardingRecord,
  storage?: StorageLike,
): OnboardingRecord {
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.setItem(ONBOARDING_KEY, JSON.stringify(record));
    } catch {
      // Ignore write failures (quota exceeded, storage disabled).
    }
  }
  return record;
}

/**
 * Record a completed Onboarding_Flow: the two Background_Question answers and the
 * per-tier Skill_Check results (Requirement 10.6).
 */
export function saveOnboardingComplete(
  experience: ExperienceAnswer,
  inputDevice: InputDeviceAnswer,
  skillCheck: Partial<Record<Tier, SkillCheckResult>>,
  now: number = Date.now(),
  storage?: StorageLike,
): OnboardingRecord {
  return saveOnboarding(
    {
      completed: true,
      skipped: false,
      experience,
      inputDevice,
      skillCheck: { ...skillCheck },
      updatedAt: now,
    },
    storage,
  );
}

/**
 * Record a skipped Onboarding_Flow: no Skill_Check results, so every Mastery_Bar
 * starts at 0% (Requirement 10.7). The Background_Question answers given before
 * the skip (if any) are preserved.
 */
export function saveOnboardingSkipped(
  experience: ExperienceAnswer | null,
  inputDevice: InputDeviceAnswer | null,
  now: number = Date.now(),
  storage?: StorageLike,
): OnboardingRecord {
  return saveOnboarding(
    {
      completed: true,
      skipped: true,
      experience,
      inputDevice,
      skillCheck: {},
      updatedAt: now,
    },
    storage,
  );
}

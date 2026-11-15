/**
 * Hub state bridge (task 7.3).
 *
 * The Progress_Service (`src/engine/progress.ts`) is pure and takes plain
 * milestone inputs. This UI-layer helper gathers those inputs from the storage
 * helpers and the authored content, so the engine stays free of storage and the
 * Hub component stays free of milestone arithmetic.
 *
 * It reads, per Difficulty:
 *   - the Skill_Check result from the Onboarding_Flow record (10.4, 10.6),
 *   - the number of that Difficulty's Lessons and how many are complete (11.9),
 *   - whether the Mastery_Checkpoint is passed (13.4),
 *   - whether a Practice_Mode board is complete (14.11),
 *   - whether a Timed_Game at that Difficulty has been won (15.8).
 */

import {
  TIERS,
  tierStatus,
  recommendation,
  type Tier,
  type TierMilestones,
  type TierStatus,
  type Recommendation,
} from '../engine/progress';
import { lessonsForTier } from '../content/lessons';
import {
  loadAllLessonProgress,
  type StorageLike as LessonStorage,
} from '../storage/lessonStorage';
import {
  isCheckpointPassed,
  type StorageLike as CheckpointStorage,
} from '../storage/checkpointStorage';
import {
  hasCompletedPractice,
  type StorageLike as PracticeStorage,
} from '../storage/practiceStorage';
import { loadResults, type StorageLike as GameStorage } from '../storage/gameStorage';
import {
  loadOnboarding,
  type StorageLike as OnboardingStorage,
} from '../storage/onboardingStorage';
import {
  loadCompletedSweepDays,
  type StorageLike as SweepStorage,
} from '../storage/sweepStorage';
import { currentStreak, longestStreak, sweepDayOf } from '../engine/streak';

/** A single Storage surface used for every read (window.localStorage in the app). */
export type HubStorage = LessonStorage &
  CheckpointStorage &
  PracticeStorage &
  GameStorage &
  OnboardingStorage &
  SweepStorage;

/** The data the Hub renders. */
export interface HubState {
  statuses: Record<Tier, TierStatus>;
  recommendation: Recommendation | null;
  /** Current and longest Daily_Streak from the local completed-Sweep_Days set. */
  dailyStreak: number;
  longestStreak: number;
}

/** True when a Timed_Game was won at `difficulty` (15.8). */
function hasWonTimed(difficulty: string, storage?: HubStorage): boolean {
  return loadResults(storage).some(
    (r) => r.difficulty === difficulty && r.metrics.outcome === 'won',
  );
}

/** The milestones for one Difficulty, read from storage and content. */
export function milestonesForTier(
  tier: Tier,
  storage?: HubStorage,
): TierMilestones {
  const lessons = lessonsForTier(tier);
  const totalLessons = lessons.length;
  const progress = loadAllLessonProgress(storage);
  const completedLessons = lessons.filter((l) =>
    progress.some((p) => p.lessonId === l.id && p.completed),
  ).length;

  const onboarding = loadOnboarding(storage);
  const skillCheck = onboarding?.skillCheck[tier] ?? null;

  return {
    skillCheck,
    totalLessons,
    completedLessons,
    checkpointPassed: isCheckpointPassed(tier, storage),
    practiceComplete: hasCompletedPractice(tier, storage),
    timedWon: hasWonTimed(tier, storage),
  };
}

/** Build the full Hub state from storage (Requirement 17.4-17.6). */
export function buildHubState(
  storage?: HubStorage,
  now: () => number = Date.now,
): HubState {
  const milestones = {} as Record<Tier, TierMilestones>;
  const statuses = {} as Record<Tier, TierStatus>;
  for (const tier of TIERS) {
    const m = milestonesForTier(tier, storage);
    milestones[tier] = m;
    statuses[tier] = tierStatus(tier, m);
  }
  // Daily_Streak (18.8) and longest streak (18.9) from the device's completed
  // Sweep_Days. Local-only for now; computed purely from the stored day set.
  const completedDays = loadCompletedSweepDays(storage);
  const today = sweepDayOf(now());
  return {
    statuses,
    recommendation: recommendation(milestones),
    dailyStreak: currentStreak(completedDays, today),
    longestStreak: longestStreak(completedDays),
  };
}

/**
 * The Progress_Service (task 7.3).
 *
 * Pure logic, no React or DOM imports, so it runs in tests and tools. It turns a
 * learner's recorded milestones into the numbers the Hub shows: a Mastery_Bar
 * per Difficulty (0-100%), the per-Difficulty loop-step status, and the single
 * recommended next step (Requirement 17).
 *
 * Mastery_Bar rules (Requirement 17.1-17.3), computed from milestones only:
 *   - 100% when the Difficulty's Mastery_Checkpoint is passed (17.1).
 *   - otherwise min(90%, skillCheckBonus + 80% x lessonsFraction), where
 *     skillCheckBonus is 10% when the Difficulty's Skill_Check result is Correct
 *     and 0% otherwise, and lessonsFraction is the fraction of that Difficulty's
 *     Lessons that are complete (17.2).
 *   - adding any milestone never lowers a Mastery_Bar (17.3 monotonicity): a
 *     Correct Skill_Check adds 10%, each completed Lesson adds a non-negative
 *     share of 80%, and passing the checkpoint jumps to 100%, so the value is
 *     monotone in the milestone inputs.
 *
 * The recommendation (17.6) picks the first incomplete loop step of the lowest
 * Difficulty whose Skill_Check result is not Correct and whose Mastery_Bar is
 * below 100%, or, when none meets both, of the lowest Difficulty whose
 * Mastery_Bar is below 100%.
 *
 * This module is given plain milestone inputs so it stays testable and free of
 * storage; `hubStateFromStorage` in the UI layer gathers those inputs from the
 * storage helpers. The Tier and SkillCheckResult types are declared here (rather
 * than imported from the content/storage layers) so the engine keeps its
 * one-way dependency: UI and content depend on the engine, never the reverse.
 */

/** The three Difficulty tiers (mirrors the content `Tier` union). */
export type Tier = 'Beginner' | 'Intermediate' | 'Expert';

/** One Skill_Check_Snippet result (mirrors the storage `SkillCheckResult`). */
export type SkillCheckResult = 'Correct' | 'Trap' | 'Other';

/** The Difficulties in curriculum order (lowest first). */
export const TIERS: Tier[] = ['Beginner', 'Intermediate', 'Expert'];

/** The four loop steps of a Difficulty, in order (requirements.md loop table). */
export type LoopStep = 'tutorial' | 'practice' | 'timed' | 'replay';

/** The recorded milestones for one Difficulty. */
export interface TierMilestones {
  /** The Skill_Check result for this Difficulty, or null when not taken (10.4). */
  skillCheck: SkillCheckResult | null;
  /** Total number of Lessons in this Difficulty's tutorial. */
  totalLessons: number;
  /** Number of those Lessons recorded complete (Requirement 11.9). */
  completedLessons: number;
  /** True once the Mastery_Checkpoint is passed (Requirement 13.4). */
  checkpointPassed: boolean;
  /** True once at least one Practice_Mode board is complete (Requirement 14.11). */
  practiceComplete: boolean;
  /** True once at least one Timed_Game at this Difficulty has been won (15.8). */
  timedWon: boolean;
}

/** The computed Hub status for one Difficulty. */
export interface TierStatus {
  tier: Tier;
  /** Mastery_Bar, an integer-free percentage in [0, 100] (Requirement 17.1-17.2). */
  masteryBar: number;
  /** Whether all Lessons are complete (Requirement 17.5). */
  allLessonsComplete: boolean;
  /** Whether the Mastery_Checkpoint is passed (Requirement 17.5). */
  checkpointPassed: boolean;
  /** Whether a Practice_Mode board is complete (Requirement 17.5). */
  practiceComplete: boolean;
  /** Whether a Timed_Game has been won (Requirement 17.5). */
  timedWon: boolean;
}

/**
 * The Mastery_Bar for one Difficulty from its milestones (Requirement 17.1-17.2).
 * Returns a number in [0, 100].
 */
export function masteryBar(m: TierMilestones): number {
  // 100% once the checkpoint is passed (17.1).
  if (m.checkpointPassed) return 100;

  // Otherwise min(90, skillCheckBonus + 80 * lessonsFraction) (17.2).
  const skillBonus = m.skillCheck === 'Correct' ? 10 : 0;
  const fraction =
    m.totalLessons > 0
      ? Math.max(0, Math.min(m.completedLessons, m.totalLessons)) / m.totalLessons
      : 0;
  const value = skillBonus + 80 * fraction;
  return Math.min(90, value);
}

/** The full Hub status for one Difficulty. */
export function tierStatus(tier: Tier, m: TierMilestones): TierStatus {
  return {
    tier,
    masteryBar: masteryBar(m),
    allLessonsComplete: m.totalLessons > 0 && m.completedLessons >= m.totalLessons,
    checkpointPassed: m.checkpointPassed,
    practiceComplete: m.practiceComplete,
    timedWon: m.timedWon,
  };
}

/**
 * The first incomplete loop step for a Difficulty, following the loop order
 * tutorial -> practice -> timed -> replay (requirements.md). A Difficulty whose
 * every step is complete returns null.
 *
 * "tutorial" is incomplete until all Lessons are complete and the checkpoint is
 * passed; "practice" until a practice board is complete; "timed"/"replay" until
 * a timed game has been won (the replay follows each timed game, so a won timed
 * game completes both).
 */
export function firstIncompleteStep(m: TierMilestones): LoopStep | null {
  const tutorialDone =
    m.totalLessons > 0 && m.completedLessons >= m.totalLessons && m.checkpointPassed;
  if (!tutorialDone) return 'tutorial';
  if (!m.practiceComplete) return 'practice';
  if (!m.timedWon) return 'timed';
  return null;
}

/** The single step the Hub recommends next (Requirement 17.6), or null. */
export interface Recommendation {
  tier: Tier;
  step: LoopStep;
}

/**
 * Recommend the first incomplete loop step of the lowest Difficulty whose
 * Skill_Check result is not Correct and whose Mastery_Bar is below 100%, or,
 * when no Difficulty meets both conditions, of the lowest Difficulty whose
 * Mastery_Bar is below 100% (Requirement 17.6). Returns null when every
 * Difficulty is at 100%.
 */
export function recommendation(
  milestones: Record<Tier, TierMilestones>,
): Recommendation | null {
  // Primary: lowest Difficulty whose Skill_Check is not Correct AND Mastery < 100.
  for (const tier of TIERS) {
    const m = milestones[tier];
    if (m.skillCheck !== 'Correct' && masteryBar(m) < 100) {
      const step = firstIncompleteStep(m);
      if (step) return { tier, step };
    }
  }
  // Fallback: lowest Difficulty whose Mastery < 100.
  for (const tier of TIERS) {
    const m = milestones[tier];
    if (masteryBar(m) < 100) {
      const step = firstIncompleteStep(m);
      if (step) return { tier, step };
    }
  }
  return null;
}

/** Human-readable label for a loop step, for the Hub's recommendation text. */
export function loopStepLabel(step: LoopStep): string {
  switch (step) {
    case 'tutorial':
      return 'tutorial';
    case 'practice':
      return 'follow-along practice';
    case 'timed':
      return 'timed game';
    case 'replay':
      return 'replay';
  }
}

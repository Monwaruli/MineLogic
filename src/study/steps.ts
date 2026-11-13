/**
 * Study_Session step model (task 9.1).
 *
 * Requirement 22.1 fixes the order of Study_Session steps:
 *
 *   Background_Questions -> Pre_Test -> Learning_Phase -> Post_Test
 *   -> Survey_Form -> completion
 *
 * Task 9.1 does NOT build the steps themselves (that is 9.2/9.3). What 9.1
 * needs from them is a notion of a sequence with a "first incomplete step" so
 * the consent/resume flow can route a Participant to where they left off
 * (21.9, 21.10). This module is that shared model: the ordered list, the type,
 * and the pure `firstIncompleteStep` helper. The Backend mirrors the same order
 * in the study_step domain (20240104000000_study_module.sql) so 9.2/9.3 slot
 * in without reordering.
 */

/** The ordered Study_Session steps (Requirement 22.1). */
export const STUDY_STEPS = [
  'Background_Questions',
  'Pre_Test',
  'Learning_Phase',
  'Post_Test',
  'Survey_Form',
  'completion',
] as const;

/** A single Study_Session step. */
export type StudyStep = (typeof STUDY_STEPS)[number];

/** The terminal step: once reached, the Study_Session is finished. */
export const FINAL_STEP: StudyStep = 'completion';

/** True when `value` is one of the known steps. */
export function isStudyStep(value: unknown): value is StudyStep {
  return typeof value === 'string' && (STUDY_STEPS as readonly string[]).includes(value);
}

/** The 0-based position of a step in the fixed order (22.1). */
export function stepIndex(step: StudyStep): number {
  return STUDY_STEPS.indexOf(step);
}

/**
 * The first incomplete step given the set of completed steps, used to resume a
 * Study_Session (21.9, 21.10). Steps are completed in order (22.1), so the
 * first incomplete step is the earliest step in STUDY_STEPS not present in
 * `completed`. When every non-terminal step is complete, the result is the
 * terminal `completion` step. The `completed` set may be given in any order or
 * contain unknown/duplicate entries; only known steps matter.
 */
export function firstIncompleteStep(completed: Iterable<string>): StudyStep {
  const done = new Set<string>();
  for (const s of completed) done.add(s);
  for (const step of STUDY_STEPS) {
    if (!done.has(step)) return step;
  }
  // Every step (including completion) is marked done: stay on completion.
  return FINAL_STEP;
}

/** True once the resume target is the terminal completion step. */
export function isComplete(step: StudyStep): boolean {
  return step === FINAL_STEP;
}

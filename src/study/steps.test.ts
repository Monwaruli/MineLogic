import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  STUDY_STEPS,
  FINAL_STEP,
  firstIncompleteStep,
  isComplete,
  isStudyStep,
  stepIndex,
  type StudyStep,
} from './steps';

describe('study steps (Requirement 22.1 order)', () => {
  it('lists the steps in the fixed 22.1 order', () => {
    expect([...STUDY_STEPS]).toEqual([
      'Background_Questions',
      'Pre_Test',
      'Learning_Phase',
      'Post_Test',
      'Survey_Form',
      'completion',
    ]);
  });

  it('with nothing completed, resumes at the first step', () => {
    expect(firstIncompleteStep([])).toBe('Background_Questions');
  });

  it('resumes at the first incomplete step in order', () => {
    expect(firstIncompleteStep(['Background_Questions'])).toBe('Pre_Test');
    expect(firstIncompleteStep(['Background_Questions', 'Pre_Test'])).toBe('Learning_Phase');
  });

  it('ignores unknown and duplicate entries', () => {
    expect(firstIncompleteStep(['Background_Questions', 'Background_Questions', 'bogus'])).toBe(
      'Pre_Test',
    );
  });

  it('resumes at completion when every non-terminal step is done', () => {
    const done = ['Background_Questions', 'Pre_Test', 'Learning_Phase', 'Post_Test', 'Survey_Form'];
    expect(firstIncompleteStep(done)).toBe('completion');
    expect(isComplete(firstIncompleteStep(done))).toBe(true);
  });

  it('isStudyStep guards known steps only', () => {
    expect(isStudyStep('Pre_Test')).toBe(true);
    expect(isStudyStep('nope')).toBe(false);
    expect(isStudyStep(42)).toBe(false);
  });

  // Property: completing a prefix of the ordered steps always resumes at the
  // next step; the resume target is deterministic for a given completed set.
  it('resume target is the step right after the completed prefix (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: STUDY_STEPS.length }), (k) => {
        const prefix = STUDY_STEPS.slice(0, k);
        const expected: StudyStep = k < STUDY_STEPS.length ? STUDY_STEPS[k]! : FINAL_STEP;
        expect(firstIncompleteStep(prefix)).toBe(expected);
      }),
    );
  });

  // Property: resume is order-insensitive — shuffling the completed set yields
  // the same first-incomplete step.
  it('resume target is insensitive to completed-set ordering (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: STUDY_STEPS.length - 1 })),
        (indices) => {
          const steps = indices.map((i) => STUDY_STEPS[i]!);
          const shuffled = [...steps].reverse();
          expect(firstIncompleteStep(shuffled)).toBe(firstIncompleteStep(steps));
        },
      ),
    );
  });

  it('stepIndex matches the fixed order', () => {
    expect(stepIndex('Background_Questions')).toBe(0);
    expect(stepIndex('completion')).toBe(STUDY_STEPS.length - 1);
  });
});

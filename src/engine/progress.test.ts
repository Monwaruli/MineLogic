import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  masteryBar,
  tierStatus,
  firstIncompleteStep,
  recommendation,
  TIERS,
  type TierMilestones,
} from './progress';
import type { Tier } from './progress';

/**
 * Tests for the Progress_Service (Requirement 17.1-17.3, 17.6).
 */

const EMPTY: TierMilestones = {
  skillCheck: null,
  totalLessons: 2,
  completedLessons: 0,
  checkpointPassed: false,
  practiceComplete: false,
  timedWon: false,
};

describe('masteryBar (Requirement 17.1-17.2)', () => {
  it('is 100% when the checkpoint is passed (17.1)', () => {
    expect(masteryBar({ ...EMPTY, checkpointPassed: true })).toBe(100);
    // 100% even if nothing else is done.
    expect(
      masteryBar({ ...EMPTY, checkpointPassed: true, completedLessons: 0, skillCheck: null }),
    ).toBe(100);
  });

  it('is 0% with no milestones', () => {
    expect(masteryBar(EMPTY)).toBe(0);
  });

  it('adds 10% for a Correct Skill_Check (17.2)', () => {
    expect(masteryBar({ ...EMPTY, skillCheck: 'Correct' })).toBe(10);
    expect(masteryBar({ ...EMPTY, skillCheck: 'Trap' })).toBe(0);
    expect(masteryBar({ ...EMPTY, skillCheck: 'Other' })).toBe(0);
  });

  it('adds 80% times the fraction of lessons complete (17.2)', () => {
    // 1 of 2 lessons: 80% * 0.5 = 40%.
    expect(masteryBar({ ...EMPTY, completedLessons: 1 })).toBe(40);
    // Both lessons, no skill check: 80% * 1 = 80%.
    expect(masteryBar({ ...EMPTY, completedLessons: 2 })).toBe(80);
  });

  it('caps the pre-checkpoint value at 90% (17.2)', () => {
    // Correct skill check (10) + both lessons (80) = 90, capped at 90.
    expect(masteryBar({ ...EMPTY, skillCheck: 'Correct', completedLessons: 2 })).toBe(90);
  });

  it('never exceeds 100 or drops below 0', () => {
    fc.assert(
      fc.property(
        fc.record({
          skillCheck: fc.constantFrom('Correct', 'Trap', 'Other', null),
          totalLessons: fc.integer({ min: 1, max: 5 }),
          completedLessons: fc.integer({ min: 0, max: 5 }),
          checkpointPassed: fc.boolean(),
          practiceComplete: fc.boolean(),
          timedWon: fc.boolean(),
        }),
        (m) => {
          const v = masteryBar(m as TierMilestones);
          return v >= 0 && v <= 100;
        },
      ),
    );
  });
});

describe('masteryBar monotonicity (Requirement 17.3)', () => {
  it('adding any milestone never lowers the bar', () => {
    const skillArb = fc.constantFrom<'Correct' | 'Trap' | 'Other' | null>(
      'Correct',
      'Trap',
      'Other',
      null,
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        skillArb,
        fc.boolean(),
        (totalLessons, completed, skill, checkpoint) => {
          const clampedCompleted = Math.min(completed, totalLessons);
          const base: TierMilestones = {
            skillCheck: skill,
            totalLessons,
            completedLessons: clampedCompleted,
            checkpointPassed: checkpoint,
            practiceComplete: false,
            timedWon: false,
          };
          const before = masteryBar(base);

          // Completing one more lesson never lowers the bar.
          const moreLessons = masteryBar({
            ...base,
            completedLessons: Math.min(clampedCompleted + 1, totalLessons),
          });
          // A Correct skill check (upgrading a non-Correct) never lowers it.
          const betterSkill = masteryBar({ ...base, skillCheck: 'Correct' });
          // Passing the checkpoint never lowers it.
          const passed = masteryBar({ ...base, checkpointPassed: true });

          return (
            moreLessons >= before && betterSkill >= before && passed >= before
          );
        },
      ),
    );
  });
});

describe('tierStatus (Requirement 17.5)', () => {
  it('reports each loop-step flag', () => {
    const s = tierStatus('Beginner', {
      ...EMPTY,
      completedLessons: 2,
      checkpointPassed: true,
      practiceComplete: true,
      timedWon: true,
    });
    expect(s.allLessonsComplete).toBe(true);
    expect(s.checkpointPassed).toBe(true);
    expect(s.practiceComplete).toBe(true);
    expect(s.timedWon).toBe(true);
    expect(s.masteryBar).toBe(100);
  });
});

describe('firstIncompleteStep', () => {
  it('walks tutorial -> practice -> timed -> null', () => {
    expect(firstIncompleteStep(EMPTY)).toBe('tutorial');
    const tutorialDone = { ...EMPTY, completedLessons: 2, checkpointPassed: true };
    expect(firstIncompleteStep(tutorialDone)).toBe('practice');
    expect(firstIncompleteStep({ ...tutorialDone, practiceComplete: true })).toBe('timed');
    expect(
      firstIncompleteStep({ ...tutorialDone, practiceComplete: true, timedWon: true }),
    ).toBeNull();
  });
});

describe('recommendation (Requirement 17.6)', () => {
  const all = (fn: (t: Tier) => TierMilestones): Record<Tier, TierMilestones> =>
    ({ Beginner: fn('Beginner'), Intermediate: fn('Intermediate'), Expert: fn('Expert') });

  it('recommends the lowest tier that is not Correct and below 100%', () => {
    const rec = recommendation(all(() => ({ ...EMPTY })));
    expect(rec).toEqual({ tier: 'Beginner', step: 'tutorial' });
  });

  it('skips a tier whose Skill_Check is Correct in favour of the next', () => {
    const milestones = all((t) =>
      t === 'Beginner'
        ? { ...EMPTY, skillCheck: 'Correct' as const }
        : { ...EMPTY },
    );
    const rec = recommendation(milestones);
    expect(rec).toEqual({ tier: 'Intermediate', step: 'tutorial' });
  });

  it('falls back to the lowest below-100% tier when all remaining are Correct', () => {
    // Every tier Correct but none at 100%: fallback picks the lowest below 100.
    const milestones = all(() => ({ ...EMPTY, skillCheck: 'Correct' as const }));
    const rec = recommendation(milestones);
    expect(rec).toEqual({ tier: 'Beginner', step: 'tutorial' });
  });

  it('returns null when every tier is at 100%', () => {
    const milestones = all(() => ({ ...EMPTY, checkpointPassed: true }));
    expect(recommendation(milestones)).toBeNull();
  });

  it('TIERS is lowest-first', () => {
    expect(TIERS).toEqual(['Beginner', 'Intermediate', 'Expert']);
  });
});

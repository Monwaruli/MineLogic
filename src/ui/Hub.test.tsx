// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import Hub, { type HubLoopStep } from './Hub';
import type { Tier } from '../engine/progress';
import { lessonsForTier } from '../content/lessons';
import type { HubStorage } from './hubState';
import { LESSONS_KEY } from '../storage/lessonStorage';
import { CHECKPOINTS_KEY } from '../storage/checkpointStorage';
import { ONBOARDING_KEY } from '../storage/onboardingStorage';

afterEach(cleanup);

function memoryStorage(initial?: Record<string, string>): HubStorage {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('Hub', () => {
  it('shows a Mastery_Bar per Difficulty, the streaks, and a leaderboards link (17.4)', () => {
    const storage = memoryStorage();
    render(<Hub onOpen={() => {}} onOpenLeaderboards={() => {}} storage={storage} />);

    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(3);
    // No milestones -> every bar is 0%.
    for (const bar of bars) {
      expect(bar.getAttribute('aria-valuenow')).toBe('0');
    }
    expect(screen.getByTestId('daily-streak')).toBeTruthy();
    expect(screen.getByTestId('longest-streak')).toBeTruthy();
    expect(screen.getByText('Leaderboards')).toBeTruthy();
  });

  it('reflects recorded milestones in the Mastery_Bar (17.1, 17.2)', () => {
    // Beginner: Skill_Check Correct (+10) and all lessons complete (+80) -> 90.
    const beginnerLessons = lessonsForTier('Beginner');
    const lessonMap: Record<string, unknown> = {};
    for (const l of beginnerLessons) {
      lessonMap[l.id] = {
        lessonId: l.id,
        completedDoSteps: l.doSteps.length,
        completed: true,
        updatedAt: 1,
      };
    }
    const storage = memoryStorage({
      [LESSONS_KEY]: JSON.stringify(lessonMap),
      [ONBOARDING_KEY]: JSON.stringify({
        completed: true,
        skipped: false,
        experience: 'casual',
        inputDevice: 'mouse',
        skillCheck: { Beginner: 'Correct' },
        updatedAt: 1,
      }),
    });
    render(<Hub onOpen={() => {}} storage={storage} />);
    const beginnerCard = screen.getByLabelText('Beginner progress');
    const bar = beginnerCard.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('90');
  });

  it('shows 100% when the checkpoint is passed (17.1)', () => {
    const storage = memoryStorage({
      [CHECKPOINTS_KEY]: JSON.stringify({
        Beginner: { tier: 'Beginner', passed: true, passedAt: 1 },
      }),
    });
    render(<Hub onOpen={() => {}} storage={storage} />);
    const beginnerCard = screen.getByLabelText('Beginner progress');
    const bar = beginnerCard.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('opens every loop step of a Difficulty (17.7)', () => {
    const storage = memoryStorage();
    const opened: Array<{ tier: Tier; step: HubLoopStep }> = [];
    render(
      <Hub
        onOpen={(tier, step) => opened.push({ tier, step })}
        storage={storage}
      />,
    );
    const beginnerCard = screen.getByLabelText('Beginner progress');
    const labels: Array<[string, HubLoopStep]> = [
      ['Tutorial', 'tutorial'],
      ['Mastery checkpoint', 'checkpoint'],
      ['Follow-along practice', 'practice'],
      ['Timed game', 'timed'],
      ['Replay last game', 'replay'],
    ];
    for (const [label, step] of labels) {
      const btn = Array.from(beginnerCard.querySelectorAll('button')).find((b) =>
        b.textContent?.includes(label),
      )!;
      fireEvent.click(btn);
      expect(opened[opened.length - 1]).toEqual({ tier: 'Beginner', step });
    }
  });

  it('recommends the lowest not-Correct, below-100% tier step (17.6)', () => {
    const storage = memoryStorage();
    render(<Hub onOpen={() => {}} storage={storage} />);
    const rec = screen.getByTestId('recommendation');
    expect(rec.textContent).toMatch(/Beginner/);
    expect(rec.textContent).toMatch(/tutorial/i);
  });
});

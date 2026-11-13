// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import StudyLearningPhase, { showsVideoPanel } from './StudyLearningPhase';
import type { StudyLearningPhaseServices } from './StudyLearningPhase';
import type { StudyGroup } from './studyService';

afterEach(cleanup);

/** Services whose assignGroup returns a fixed group and records the call. */
function fakeServices(group: StudyGroup): {
  services: Partial<StudyLearningPhaseServices>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    services: {
      assignGroup: async (participantId: string) => {
        calls.push(participantId);
        return group;
      },
    },
  };
}

/** Flush pending promises + effects so async state settles. */
async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * Advance through the skill check and the Beginner block into Intermediate.
 * Assumes it is called from the initial skill-check screen.
 */
async function reachIntermediate() {
  // Skill check -> Beginner lessons.
  act(() => {
    fireEvent.click(screen.getByTestId('study-skillcheck-continue'));
  });
  // Walk the Beginner lessons via the Continue control until the checkpoint.
  for (let i = 0; i < 8 && screen.queryByTestId('study-lessons-continue'); i++) {
    act(() => {
      fireEvent.click(screen.getByTestId('study-lessons-continue'));
    });
    if (!screen.queryByTestId('study-block-lessons')) break;
  }
  // Beginner checkpoint -> practice -> next block.
  if (screen.queryByTestId('study-checkpoint-continue')) {
    act(() => fireEvent.click(screen.getByTestId('study-checkpoint-continue')));
  }
  if (screen.queryByTestId('study-practice-continue')) {
    act(() => fireEvent.click(screen.getByTestId('study-practice-continue')));
  }
  await flush();
}

describe('showsVideoPanel gate (Requirements 23.6, 23.7, 23.8)', () => {
  it('Beginner and Expert show the panel for both groups (23.8)', () => {
    expect(showsVideoPanel('Beginner', 'Group_A')).toBe(true);
    expect(showsVideoPanel('Beginner', 'Group_B')).toBe(true);
    expect(showsVideoPanel('Expert', 'Group_B')).toBe(true);
  });

  it('Intermediate shows the panel for Group_A only (23.6, 23.7)', () => {
    expect(showsVideoPanel('Intermediate', 'Group_A')).toBe(true);
    expect(showsVideoPanel('Intermediate', 'Group_B')).toBe(false);
    expect(showsVideoPanel('Intermediate', null)).toBe(false);
  });
});

describe('StudyLearningPhase group assignment + video gate (Requirement 23)', () => {
  it('assigns a group on reaching the Intermediate block (23.3)', async () => {
    const { services, calls } = fakeServices('Group_A');
    render(
      <StudyLearningPhase
        participantId="p-123"
        includesExpert={false}
        services={services}
        onComplete={() => {}}
      />,
    );
    // No assignment during the skill check (still on the skill-check screen).
    expect(calls).toEqual([]);

    await reachIntermediate();
    expect(calls).toEqual(['p-123']);
  });

  it('shows the Intermediate Video_Panel for Group_A (23.6)', async () => {
    const { services } = fakeServices('Group_A');
    render(
      <StudyLearningPhase
        participantId="p-A"
        includesExpert={false}
        intermediateVideoSource="https://example.com/intermediate.mp4"
        services={services}
        onComplete={() => {}}
      />,
    );
    await reachIntermediate();
    expect(screen.getByTestId('study-block-tier').textContent).toMatch(/Intermediate/);
    // The group assignment resolves asynchronously; wait for the panel to show.
    expect(await screen.findByTestId('study-video-wrap')).toBeTruthy();
  });

  it('hides the Intermediate Video_Panel for Group_B (23.7)', async () => {
    const { services } = fakeServices('Group_B');
    render(
      <StudyLearningPhase
        participantId="p-B"
        includesExpert={false}
        intermediateVideoSource="https://example.com/intermediate.mp4"
        services={services}
        onComplete={() => {}}
      />,
    );
    await reachIntermediate();
    expect(screen.getByTestId('study-block-tier').textContent).toMatch(/Intermediate/);
    expect(screen.queryByTestId('study-video-wrap')).toBeNull();
  });

  it('shows the Beginner Video_Panel for both groups (23.8)', () => {
    const { services } = fakeServices('Group_B');
    render(
      <StudyLearningPhase
        participantId="p-beg"
        includesExpert={false}
        services={services}
        onComplete={() => {}}
      />,
    );
    act(() => fireEvent.click(screen.getByTestId('study-skillcheck-continue')));
    // In the Beginner block the video wrap is present regardless of group.
    expect(screen.getByTestId('study-block-tier').textContent).toMatch(/Beginner/);
    expect(screen.queryByTestId('study-video-wrap')).not.toBeNull();
  });

  it('keeps an existing group on resume without reassigning (23.5)', async () => {
    const { services, calls } = fakeServices('Group_A');
    render(
      <StudyLearningPhase
        participantId="p-resume"
        includesExpert={false}
        initialGroup="Group_B"
        services={services}
        onComplete={() => {}}
      />,
    );
    await reachIntermediate();
    // A participant with an initial group is not reassigned.
    expect(calls).toEqual([]);
    // Group_B hides the Intermediate panel.
    expect(screen.queryByTestId('study-video-wrap')).toBeNull();
  });
});

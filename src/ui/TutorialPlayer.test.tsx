// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import TutorialPlayer from './TutorialPlayer';
import { lessonById } from '../content/lessons';
import { parseBoard } from '../engine/boardFormat';
import {
  loadLessonProgress,
  saveLessonProgress,
  type StorageLike,
} from '../storage/lessonStorage';

/**
 * UI tests for the Tutorial_Player (task 7.1, Requirement 11.2-11.10).
 *
 * The component drives the authored Lessons through the pure engine, so these
 * tests use real Lesson content rather than fixtures: the Learn_Steps render
 * with Overlays and explanations, the Do_Steps intercept non-provable moves,
 * the Next control gates on the Objective, and progress is persisted and
 * resumed from local storage.
 */

const exposed = lessonById('beginner-exposed-mines')!;

function memoryStorage(): StorageLike {
  const data: Record<string, string> = {};
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

function tileAt(row: number, col: number): HTMLButtonElement {
  return document.querySelector(
    `button[data-row="${row}"][data-col="${col}"]`,
  ) as HTMLButtonElement;
}

function primaryClick(row: number, col: number) {
  act(() => {
    fireEvent.mouseDown(tileAt(row, col), { button: 0, buttons: 1 });
  });
}

afterEach(cleanup);

describe('TutorialPlayer - Learn_Steps (Req 11.2)', () => {
  it('shows the first Learn_Step with its explanation and labeled Overlays', () => {
    render(
      <TutorialPlayer lesson={exposed} onHome={() => {}} storage={memoryStorage()} />,
    );
    expect(screen.getByText(exposed.title)).toBeTruthy();
    expect(screen.getByTestId('learn-explanation').textContent).toBe(
      exposed.learnSteps[0].explanation,
    );
    // The Overlays are drawn as role-tagged, labeled Tiles on the demo board.
    const mineOverlay = exposed.learnSteps[0].overlays.find((o) => o.role === 'mine')!;
    const [mr, mc] = mineOverlay.tiles[0];
    expect(tileAt(mr, mc).getAttribute('data-role')).toBe('mine');
    expect(tileAt(mr, mc).getAttribute('aria-label')).toContain(mineOverlay.label);
  });

  it('advances from the last Learn_Step into the Do_Steps', () => {
    render(
      <TutorialPlayer lesson={exposed} onHome={() => {}} storage={memoryStorage()} />,
    );
    // One Learn_Step -> the Next button starts practicing.
    act(() => {
      fireEvent.click(screen.getByTestId('learn-next'));
    });
    expect(screen.getByTestId('do-progress').textContent).toContain('1 /');
    expect(screen.getByTestId('do-prompt').textContent).toBe(exposed.doSteps[0].prompt);
  });
});

describe('TutorialPlayer - Do_Steps (Req 11.4-11.8)', () => {
  function startDoSteps(storage: StorageLike) {
    render(<TutorialPlayer lesson={exposed} onHome={() => {}} storage={storage} />);
    act(() => {
      fireEvent.click(screen.getByTestId('learn-next'));
    });
  }

  it('keeps Next disabled until the Objective is met (11.7, 11.8)', () => {
    startDoSteps(memoryStorage());
    const next = screen.getByTestId('do-next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    // Reveal the Do_Step's target(s): all Provably_Safe -> applied (11.4).
    for (const [r, c] of exposed.doSteps[0].targets) {
      primaryClick(r, c);
    }
    expect(screen.getByTestId('do-complete')).toBeTruthy();
    expect((screen.getByTestId('do-next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('intercepts a non-provable reveal, marks the Tile, and leaves the board unchanged (11.5)', () => {
    startDoSteps(memoryStorage());
    // The exposed mine is not Provably_Safe; clicking it is intercepted.
    const board = parseBoard(exposed.doSteps[0].boardText);
    const [mr, mc] = board.mines[0];
    primaryClick(mr, mc);

    expect(screen.getByRole('status').textContent).toMatch(/cannot be proven/i);
    // The attempted Tile is marked with the error overlay, and stays covered.
    expect(tileAt(mr, mc).getAttribute('data-role')).toBe('error');
    expect(tileAt(mr, mc).getAttribute('aria-label')).toContain('covered');
  });
});

describe('TutorialPlayer - progress persistence (Req 11.9, 11.10)', () => {
  it('records the Lesson complete after the last Do_Step (11.9)', () => {
    const storage = memoryStorage();
    let completed = false;
    render(
      <TutorialPlayer
        lesson={exposed}
        onHome={() => {}}
        onComplete={() => {
          completed = true;
        }}
        storage={storage}
      />,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('learn-next'));
    });

    // Complete every Do_Step in turn, clicking Next between them.
    for (let i = 0; i < exposed.doSteps.length; i++) {
      for (const [r, c] of exposed.doSteps[i].targets) {
        primaryClick(r, c);
      }
      act(() => {
        fireEvent.click(screen.getByTestId('do-next'));
      });
    }

    expect(completed).toBe(true);
    const progress = loadLessonProgress(exposed.id, storage);
    expect(progress?.completed).toBe(true);
    expect(progress?.completedDoSteps).toBe(exposed.doSteps.length);
  });

  it('resumes a partly-completed Lesson at the first incomplete Do_Step (11.10)', () => {
    const storage = memoryStorage();
    // Pretend the first of two Do_Steps was already completed.
    saveLessonProgress(exposed.id, 1, exposed.doSteps.length, 0, storage);

    render(<TutorialPlayer lesson={exposed} onHome={() => {}} storage={storage} />);
    // Skips the Learn_Steps and resumes at Do_Step 2 (index 1).
    expect(screen.getByTestId('do-progress').textContent).toContain('2 /');
    expect(screen.getByTestId('do-prompt').textContent).toBe(exposed.doSteps[1].prompt);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import StudySession from './StudySession';
import type { StudyConfig } from './studyService';
import type { StorageLike } from './studySessionStorage';
import {
  loadTestMarker,
  saveStudySession,
  loadStudySession,
} from './studySessionStorage';
import { printBoard } from '../engine/boardFormat';
import type { Board } from '../engine/board';

afterEach(cleanup);

/** A fully-solvable 3x3 board, as Board_Format text, that wins on one reveal. */
function winBoardText(id: string): string {
  const board: Board = { id, width: 3, height: 3, mines: [[0, 2]], startTile: [2, 0] };
  return printBoard(board);
}

function memoryStorage(): StorageLike {
  const data: Record<string, string> = {};
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

function baseConfig(overrides: Partial<StudyConfig> = {}): StudyConfig {
  return {
    id: 'cfg-1',
    studyCode: 'S1',
    consentText: 't',
    consentVersion: 'v1',
    consentStatements: ['a'],
    includesExpert: false,
    preBeginner: winBoardText('pre-b'),
    preIntermediate: winBoardText('pre-i'),
    postBeginner: winBoardText('post-b'),
    postIntermediate: winBoardText('post-i'),
    postExpert: null,
    intermediateVideoSource: 'https://v',
    surveyRatingItems: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'],
    surveyOpenPrompts: ['o1', 'o2', 'o3'],
    surveyDemographicsItem: 'demo',
    ...overrides,
  };
}

function tileAt(row: number, col: number): HTMLButtonElement {
  return document.querySelector(
    `button[data-row="${row}"][data-col="${col}"]`,
  ) as HTMLButtonElement;
}

/** Register a local session pointer so markStepComplete can persist. */
function seedPointer(storage: StorageLike) {
  saveStudySession(
    { studyCode: 'S1', participantId: 'p1', resumeCode: 'MLS-ABCD-EFGH', completedSteps: [] },
    0,
    storage,
  );
}

describe('StudySession step order (Requirement 22.1, 22.2)', () => {
  it('starts at Background_Questions and advances to Pre_Test', () => {
    const storage = memoryStorage();
    seedPointer(storage);
    render(
      <StudySession
        studyCode="S1"
        participantId="p1"
        resumeCode="MLS-ABCD-EFGH"
        config={baseConfig()}
        startStep="Background_Questions"
        storage={storage}
        now={() => 0}
      />,
    );
    expect(screen.getByTestId('study-step-background')).toBeTruthy();
    act(() => fireEvent.click(screen.getByTestId('background-continue')));
    // Background_Questions is now marked complete, so resume lands on Pre_Test.
    expect(loadStudySession('S1', storage)?.completedSteps).toContain('Background_Questions');
    expect(screen.getByTestId('study-step-pretest')).toBeTruthy();
  });

  it('Pre_Test plays Pre_Beginner then Pre_Intermediate (22.3)', () => {
    const storage = memoryStorage();
    seedPointer(storage);
    render(
      <StudySession
        studyCode="S1"
        participantId="p1"
        resumeCode="MLS-ABCD-EFGH"
        config={baseConfig()}
        startStep="Pre_Test"
        storage={storage}
        now={() => 0}
      />,
    );
    // First board is Pre_Beginner.
    expect(screen.getByTestId('study-test-progress').textContent).toMatch(/Pre_Beginner/);
    // Win it: reveal the Start_Tile.
    act(() => fireEvent.mouseDown(tileAt(2, 0), { button: 0, buttons: 1 }));
    act(() => fireEvent.click(document.body)); // no-op to flush
    // The ended screen appears; the phase then advances to the next board.
    // Second board is Pre_Intermediate.
    expect(screen.getByTestId('study-test-progress').textContent).toMatch(/Pre_Intermediate/);
  });

  it('Pre_Test completes after both boards and marks the step done', () => {
    const storage = memoryStorage();
    seedPointer(storage);
    render(
      <StudySession
        studyCode="S1"
        participantId="p1"
        resumeCode="MLS-ABCD-EFGH"
        config={baseConfig()}
        startStep="Pre_Test"
        storage={storage}
        now={() => 0}
      />,
    );
    // Win Pre_Beginner.
    act(() => fireEvent.mouseDown(tileAt(2, 0), { button: 0, buttons: 1 }));
    // Win Pre_Intermediate.
    act(() => fireEvent.mouseDown(tileAt(2, 0), { button: 0, buttons: 1 }));
    expect(loadStudySession('S1', storage)?.completedSteps).toContain('Pre_Test');
    // After Pre_Test, resume lands on Learning_Phase.
    expect(screen.getByTestId('study-step-learning')).toBeTruthy();
  });

  it('writes and clears the test-in-progress marker around a game (22.12)', () => {
    const storage = memoryStorage();
    seedPointer(storage);
    render(
      <StudySession
        studyCode="S1"
        participantId="p1"
        resumeCode="MLS-ABCD-EFGH"
        config={baseConfig()}
        startStep="Pre_Test"
        storage={storage}
        now={() => 0}
      />,
    );
    // While the first game is on screen, the marker is set.
    expect(loadTestMarker('S1', storage)?.step).toBe('Pre_Test');
    // Winning the first game clears the marker before the next one re-sets it.
    act(() => fireEvent.mouseDown(tileAt(2, 0), { button: 0, buttons: 1 }));
    // The second game sets the marker again for Pre_Intermediate (still Pre_Test).
    expect(loadTestMarker('S1', storage)?.step).toBe('Pre_Test');
    expect(loadTestMarker('S1', storage)?.boardId).toBe('pre-i');
  });
});

describe('StudySession Post_Test Expert gating (Requirement 22.4)', () => {
  it('adds Post_Expert only when the config includes Expert', () => {
    const storage = memoryStorage();
    seedPointer(storage);
    const cfg = baseConfig({ includesExpert: true, postExpert: winBoardText('post-x') });
    render(
      <StudySession
        studyCode="S1"
        participantId="p1"
        resumeCode="MLS-ABCD-EFGH"
        config={cfg}
        startStep="Post_Test"
        storage={storage}
        now={() => 0}
      />,
    );
    expect(screen.getByTestId('study-test-progress').textContent).toMatch(/board 1 of 3/);
  });

  it('Post_Test has two boards when Expert is excluded', () => {
    const storage = memoryStorage();
    seedPointer(storage);
    render(
      <StudySession
        studyCode="S1"
        participantId="p1"
        resumeCode="MLS-ABCD-EFGH"
        config={baseConfig()}
        startStep="Post_Test"
        storage={storage}
        now={() => 0}
      />,
    );
    expect(screen.getByTestId('study-test-progress').textContent).toMatch(/board 1 of 2/);
  });
});

describe('StudySession completion (Requirement 22.1)', () => {
  it('shows the Resume_Code on the completion screen', () => {
    const storage = memoryStorage();
    seedPointer(storage);
    render(
      <StudySession
        studyCode="S1"
        participantId="p1"
        resumeCode="MLS-WXYZ-1234"
        config={baseConfig()}
        startStep="completion"
        storage={storage}
        now={() => 0}
      />,
    );
    expect(screen.getByTestId('completion-resume-code').textContent).toContain('MLS-WXYZ-1234');
  });
});

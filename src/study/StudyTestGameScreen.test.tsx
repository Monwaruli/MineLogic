// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import type { Board } from '../engine/board';
import StudyTestGameScreen, { type TestGameResult } from './StudyTestGameScreen';

afterEach(cleanup);

/**
 * A fully-solvable 3x3 fixed Evaluation_Board. One mine at (0,2); Start_Tile
 * (2,0) is a zero whose Opening clears every non-mine Tile, so a single reveal
 * wins. Used as the fixed board a test game plays (22.8).
 *
 *   . . *
 *   . . .
 *   S . .
 */
const winBoard: Board = {
  id: 'eval-3x3-win',
  width: 3,
  height: 3,
  mines: [[0, 2]],
  startTile: [2, 0],
};

/**
 * A board whose Start_Tile reveal leaves the game in progress, so the time cap
 * can fire before win/loss. Mines at (0,0) and (2,2); Start_Tile (0,2) opens
 * only the top region.
 */
const partialBoard: Board = {
  id: 'eval-3x3-partial',
  width: 3,
  height: 3,
  mines: [
    [0, 0],
    [2, 2],
  ],
  startTile: [0, 2],
};

function tileAt(row: number, col: number): HTMLButtonElement {
  return document.querySelector(
    `button[data-row="${row}"][data-col="${col}"]`,
  ) as HTMLButtonElement;
}

describe('StudyTestGameScreen — one attempt, no restart (Requirement 22.8)', () => {
  it('renders no restart or new-board control', () => {
    render(
      <StudyTestGameScreen board={winBoard} tier="Beginner" onFinished={() => {}} now={() => 0} />,
    );
    // The normal GameScreen has these; the test game must not.
    expect(screen.queryByTestId('ingame-restart')).toBeNull();
    expect(screen.queryByTestId('ingame-newboard')).toBeNull();
  });

  it('shows the controls reminder when provided (22.7)', () => {
    render(
      <StudyTestGameScreen
        board={winBoard}
        tier="Beginner"
        controlsReminder="Left-click reveal. Right-click flag."
        onFinished={() => {}}
        now={() => 0}
      />,
    );
    expect(screen.getByTestId('study-test-controls').textContent).toMatch(/reveal/i);
  });

  it('ends on a win and shows ONLY the outcome and elapsed time (22.11)', () => {
    let t = 1000;
    const now = () => t;
    const results: TestGameResult[] = [];
    render(
      <StudyTestGameScreen
        board={winBoard}
        tier="Beginner"
        onFinished={(r) => results.push(r)}
        now={now}
      />,
    );

    // Reveal the Start_Tile at t=1000; its Opening clears the board -> win.
    act(() => {
      fireEvent.mouseDown(tileAt(2, 0), { button: 0, buttons: 1 });
    });

    // The end screen shows outcome + elapsed, and no full metrics summary.
    expect(screen.getByTestId('study-test-ended')).toBeTruthy();
    expect(screen.getByTestId('study-test-outcome').textContent).toMatch(/Cleared/);
    expect(screen.getByTestId('study-test-elapsed')).toBeTruthy();

    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe('won');
    // Metrics are computed with the shared Metrics_Engine.
    expect(results[0].metrics.metricsVersion).toBeGreaterThan(0);
    expect(results[0].boardId).toBe('eval-3x3-win');
  });
});

describe('StudyTestGameScreen — time cap (Requirements 22.9, 22.10)', () => {
  it('ends Timed_Out at the default Beginner cap and computes metrics from pre-cap actions', () => {
    vi.useFakeTimers();
    try {
      let t = 0;
      const now = () => t;
      const results: TestGameResult[] = [];
      render(
        <StudyTestGameScreen
          board={partialBoard}
          tier="Beginner"
          configuredCapMs={null}
          onFinished={(r) => results.push(r)}
          now={now}
        />,
      );

      // Start the game at t=0 so the clock begins.
      act(() => {
        fireEvent.mouseDown(tileAt(0, 2), { button: 0, buttons: 1 });
      });

      // Advance the WALL CLOCK past the 4-minute Beginner default cap, then let
      // the cap-checking interval fire.
      t = 4 * 60 * 1000 + 10;
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(results).toHaveLength(1);
      expect(results[0].outcome).toBe('Timed_Out');
      // Elapsed reported as the cap (22.9/22.10).
      expect(results[0].elapsedMs).toBe(4 * 60 * 1000);
      // A Timed_Out game is not won -> no Chording_Efficiency.
      expect(results[0].metrics.chordingEfficiency).toBeNull();

      // The end screen shows only outcome + elapsed (22.11).
      expect(screen.getByTestId('study-test-outcome').textContent).toMatch(/Time ran out/);
    } finally {
      vi.useRealTimers();
    }
  });
});

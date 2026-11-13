// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import GameScreen from './GameScreen';
import type { GeneratedBoard } from '../engine/generator';
import type { StorageLike } from '../storage/gameStorage';
import { loadResults } from '../storage/gameStorage';
import { DIFFICULTIES, type Board } from '../engine/board';

/**
 * A deterministic, fully-solvable 3x3 board used as a presetBoard so the screen
 * never calls the generator. One mine at (0,2); Start_Tile (2,0) is a zero.
 *
 *   . . *
 *   . . .
 *   S . .
 */
const board: Board = {
  id: 'test-3x3',
  width: 3,
  height: 3,
  mines: [[0, 2]],
  startTile: [2, 0],
};

const preset: GeneratedBoard = {
  board,
  metadata: { seed: 42, generatorVersion: 1, threeBV: 1 },
};

/**
 * A board whose Start_Tile reveal does NOT clear the whole board, so the game
 * stays in progress (and the clock keeps running) after the first reveal.
 * Mines at (0,0) and (2,2); Start_Tile (0,2) is a zero that opens only the top
 * region, leaving (1,0), (2,0), (2,1) covered.
 *
 *   * . S
 *   . . .
 *   . . *
 */
const partialBoard: Board = {
  id: 'test-partial',
  width: 3,
  height: 3,
  mines: [
    [0, 0],
    [2, 2],
  ],
  startTile: [0, 2],
};

const partialPreset: GeneratedBoard = {
  board: partialBoard,
  metadata: { seed: 7, generatorVersion: 1, threeBV: 3 },
};

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

afterEach(cleanup);

describe('GameScreen clock', () => {
  it('shows 0:00 until the Start_Tile is revealed, then counts from the reveal', () => {
    vi.useFakeTimers();
    let t = 1000;
    const now = () => t;

    try {
      render(
        <GameScreen
          difficulty={DIFFICULTIES.Beginner}
          seed={7}
          presetBoard={partialPreset}
          now={now}
          storage={memoryStorage()}
          onHome={() => {}}
          onPlayAgain={() => {}}
        />,
      );

      // Before the start reveal, the clock is frozen at 0:00 even as time
      // passes, because the clock only starts at the Start_Tile reveal.
      const clock = screen.getByTestId('clock');
      t = 9000;
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(clock.textContent).toContain('0:00');

      // The start guidance note is shown before the first reveal.
      expect(screen.queryByRole('note')).not.toBeNull();

      // Reveal the Start_Tile (0,2) at t=9000; its opening does not clear the
      // whole board, so the game stays in progress and the clock runs.
      act(() => {
        fireEvent.mouseDown(tileAt(0, 2), { button: 0, buttons: 1 });
      });

      // The start reveal registered: the guidance note is gone.
      expect(screen.queryByRole('note')).toBeNull();

      // Advance wall-clock by 3s; the interval tick recomputes from the real
      // clock, so the display reflects true elapsed time even if the tab was
      // hidden between ticks.
      t = 12000;
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByTestId('clock').textContent).toContain('0:03');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a mine counter equal to mine count minus flags', () => {
    render(
      <GameScreen
        difficulty={DIFFICULTIES.Beginner}
        seed={42}
        presetBoard={preset}
        now={() => 0}
        storage={memoryStorage()}
        onHome={() => {}}
        onPlayAgain={() => {}}
      />,
    );
    expect(screen.getByTestId('mine-counter').textContent).toContain('1');
  });
});

describe('GameScreen end flow', () => {
  it('winning shows the summary with metrics and saves the result', async () => {
    vi.useFakeTimers();
    let t = 0;
    const now = () => t;
    const storage = memoryStorage();

    try {
      render(
        <GameScreen
          difficulty={DIFFICULTIES.Beginner}
          seed={42}
          presetBoard={preset}
          now={now}
          storage={storage}
          onHome={() => {}}
          onPlayAgain={() => {}}
        />,
      );

      // Reveal the start first, then every other non-mine tile, to force a win
      // deterministically (the cascade alone may stop at numbered tiles).
      t = 100;
      act(() => {
        fireEvent.mouseDown(tileAt(2, 0), { button: 0, buttons: 1 });
      });
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (r === 0 && c === 2) continue; // the mine
          act(() => {
            fireEvent.mouseDown(tileAt(r, c), { button: 0, buttons: 1 });
          });
        }
      }

      // Metrics are computed on a deferred timeout; flush it.
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByLabelText('Game summary')).toBeTruthy();
      expect(screen.getByText('You won')).toBeTruthy();
      // Logical_Move_Rate renders (the single reveal was the start, not counted,
      // so the rate may be n/a — assert the field is present either way).
      expect(screen.getByTestId('summary-lmr')).toBeTruthy();

      // The finished result was persisted.
      const saved = loadResults(storage);
      expect(saved).toHaveLength(1);
      expect(saved[0]!.boardText).toContain('version 1');
      expect(saved[0]!.moveLogText).toContain('movelog 1');
    } finally {
      vi.useRealTimers();
    }
  });
});

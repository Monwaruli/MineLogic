// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import PracticeScreen from './PracticeScreen';
import type { GeneratedBoard } from '../engine/generator';
import type { StorageLike } from '../storage/practiceStorage';
import { loadPracticeCompletions } from '../storage/practiceStorage';
import { DIFFICULTIES, type Board } from '../engine/board';

/**
 * Deterministic, fully-solvable 3x3 board used as a presetBoard so the screen
 * never calls the generator. One mine at (0,2); Start_Tile (2,0) is a zero that
 * opens the whole board except the single mine.
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
 * A board whose Start_Tile opening leaves a genuinely unprovable tile, so a
 * click can be intercepted. Mines at (0,0) and (2,2). Start_Tile (0,2) opens a
 * small region; with two mines and several covered tiles, some tiles are not
 * Provably_Safe right after the opening.
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

function primaryClick(row: number, col: number) {
  act(() => {
    fireEvent.mouseDown(tileAt(row, col), { button: 0, buttons: 1 });
  });
}

function secondaryClick(row: number, col: number) {
  act(() => {
    fireEvent.mouseDown(tileAt(row, col), { button: 2, buttons: 2 });
  });
}

afterEach(cleanup);

describe('PracticeScreen', () => {
  it('shows no clock (untimed) and a mine counter', () => {
    render(
      <PracticeScreen
        difficulty={DIFFICULTIES.Beginner}
        seed={42}
        presetBoard={preset}
        now={() => 0}
        storage={memoryStorage()}
        onHome={() => {}}
        onPlayAgain={() => {}}
      />,
    );
    // Untimed: there is no clock testid.
    expect(screen.queryByTestId('clock')).toBeNull();
    expect(screen.getByTestId('mine-counter').textContent).toContain('1');
  });

  it('intercepts an unprovable click, shows a message and a More Help control, and leaves the board unchanged', () => {
    render(
      <PracticeScreen
        difficulty={DIFFICULTIES.Intermediate}
        seed={7}
        presetBoard={partialPreset}
        now={() => 0}
        storage={memoryStorage()}
        onHome={() => {}}
        onPlayAgain={() => {}}
      />,
    );

    // Reveal the Start_Tile (0,2) to open the board.
    primaryClick(0, 2);

    // Snapshot the revealed tiles before the intercepted click.
    const revealedBefore = document.querySelectorAll('[aria-label*="empty"], [aria-label*=": 1"], [aria-label*=": 2"], [aria-label*=": 3"]').length;

    // Click the known mine at (0,0): it cannot be proven safe, so it is
    // intercepted (no reveal) and a Nudge message appears.
    primaryClick(0, 0);

    // A message is shown and the More Help control appears (stage 1).
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(/isn't provably safe yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /more help/i })).toBeTruthy();

    // The board is unchanged: the mine tile is still covered (guardrail 14.8).
    expect(tileAt(0, 0).getAttribute('aria-label')).toContain('covered');
    const revealedAfter = document.querySelectorAll('[aria-label*="empty"], [aria-label*=": 1"], [aria-label*=": 2"], [aria-label*=": 3"]').length;
    expect(revealedAfter).toBe(revealedBefore);
  });

  it('More Help advances the Nudge to stage 2 and highlights anchors', () => {
    render(
      <PracticeScreen
        difficulty={DIFFICULTIES.Intermediate}
        seed={7}
        presetBoard={partialPreset}
        now={() => 0}
        storage={memoryStorage()}
        onHome={() => {}}
        onPlayAgain={() => {}}
      />,
    );
    primaryClick(0, 2); // open
    primaryClick(0, 0); // intercepted -> stage 1

    // Stage 1 draws the region but no anchors yet.
    expect(document.querySelector('[data-anchor="true"]')).toBeNull();

    // More Help -> stage 2 highlights the Anchor_Numbers.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /more help/i }));
    });
    expect(document.querySelector('[data-anchor="true"]')).not.toBeNull();
    // The More Help control is gone once stage 2 is the most detailed help.
    expect(screen.queryByRole('button', { name: /more help/i })).toBeNull();
  });

  it('applies a Flag_Toggle without any check (flags apply freely)', () => {
    render(
      <PracticeScreen
        difficulty={DIFFICULTIES.Intermediate}
        seed={7}
        presetBoard={partialPreset}
        now={() => 0}
        storage={memoryStorage()}
        onHome={() => {}}
        onPlayAgain={() => {}}
      />,
    );
    primaryClick(0, 2); // open
    // Flag the mine tile (0,0): flags apply unconditionally (14.9).
    secondaryClick(0, 0);
    expect(tileAt(0, 0).getAttribute('aria-label')).toContain('flagged');
  });

  it('clearing the board shows the completion summary and records it in storage', () => {
    const storage = memoryStorage();
    render(
      <PracticeScreen
        difficulty={DIFFICULTIES.Beginner}
        seed={42}
        presetBoard={preset}
        now={() => 12345}
        storage={storage}
        onHome={() => {}}
        onPlayAgain={() => {}}
      />,
    );

    // Reveal the start; its opening clears every non-mine tile on this board.
    primaryClick(2, 0);
    // Reveal any remaining safe tiles to guarantee a win.
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (r === 0 && c === 2) continue; // the mine
        primaryClick(r, c);
      }
    }

    // The completion summary is shown with both counts.
    expect(screen.getByLabelText('Practice complete')).toBeTruthy();
    expect(screen.getByTestId('final-intercepts').textContent).toBe('0');
    expect(screen.getByTestId('final-stage2').textContent).toBe('0');

    // The completion was recorded in storage (14.11).
    const completions = loadPracticeCompletions(storage);
    expect(completions).toHaveLength(1);
    expect(completions[0]!.difficulty).toBe('Beginner');
    expect(completions[0]!.boardId).toBe('test-3x3');
  });
});

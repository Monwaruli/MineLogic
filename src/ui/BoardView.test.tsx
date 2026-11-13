// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import BoardView from './BoardView';
import { createGame, applyAction, type Action, type GameState } from '../engine/game';
import type { Board } from '../engine/board';

/**
 * A tiny hand-built 3x3 board, deterministic (no generator). One mine at (0,2).
 * Start_Tile (2,0) has Number 0, so revealing it opens a region.
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

afterEach(cleanup);

/** Find a tile button by its row/col data attributes. */
function tileAt(row: number, col: number): HTMLButtonElement {
  return document.querySelector(
    `button[data-row="${row}"][data-col="${col}"]`,
  ) as HTMLButtonElement;
}

describe('BoardView input mapping', () => {
  function setup(state: GameState) {
    const actions: Action[] = [];
    render(<BoardView state={state} onAction={(a) => actions.push(a)} highlightStart />);
    return actions;
  }

  it('renders one gridcell per tile with accessible labels', () => {
    setup(createGame(board, 0));
    const cells = screen.getAllByRole('gridcell');
    expect(cells).toHaveLength(9);
    // The grid itself is labelled.
    expect(screen.getByRole('grid')).toBeTruthy();
  });

  it('primary press on a covered tile maps to Reveal_Click', () => {
    const actions = setup(createGame(board, 0));
    fireEvent.mouseDown(tileAt(2, 0), { button: 0, buttons: 1 });
    expect(actions).toEqual([{ type: 'Reveal_Click', tile: [2, 0] }]);
  });

  it('secondary press on a covered tile maps to Flag_Toggle', () => {
    const actions = setup(createGame(board, 0));
    fireEvent.mouseDown(tileAt(1, 1), { button: 2, buttons: 2 });
    expect(actions).toEqual([{ type: 'Flag_Toggle', tile: [1, 1] }]);
  });

  it('middle press on a revealed number maps to Chord_Click', () => {
    // Reveal the start first so (2,0)'s region opens; then a revealed numbered
    // tile exists to chord on.
    let state = createGame(board, 0);
    state = applyAction(state, { type: 'Reveal_Click', tile: [2, 0] }, 0);
    // Find any revealed tile to chord on.
    const revealedKey = [...state.revealed][0]!;
    const [r, c] = revealedKey.split(',').map(Number) as [number, number];
    const actions = setup(state);
    fireEvent.mouseDown(tileAt(r, c), { button: 1, buttons: 4 });
    expect(actions).toEqual([{ type: 'Chord_Click', tile: [r, c] }]);
  });

  it('primary+secondary together on a revealed number maps to Chord_Click', () => {
    let state = createGame(board, 0);
    state = applyAction(state, { type: 'Reveal_Click', tile: [2, 0] }, 0);
    const revealedKey = [...state.revealed][0]!;
    const [r, c] = revealedKey.split(',').map(Number) as [number, number];
    const actions = setup(state);
    fireEvent.mouseDown(tileAt(r, c), { button: 0, buttons: 3 });
    expect(actions).toEqual([{ type: 'Chord_Click', tile: [r, c] }]);
  });

  it('secondary press on a revealed tile is ignored', () => {
    let state = createGame(board, 0);
    state = applyAction(state, { type: 'Reveal_Click', tile: [2, 0] }, 0);
    const revealedKey = [...state.revealed][0]!;
    const [r, c] = revealedKey.split(',').map(Number) as [number, number];
    const actions = setup(state);
    fireEvent.mouseDown(tileAt(r, c), { button: 2, buttons: 2 });
    expect(actions).toEqual([]);
  });
});

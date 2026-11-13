// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import EndSummary from './EndSummary';
import { computeMetrics } from '../engine/metrics';
import { createGame, applyAction, type GameState } from '../engine/game';
import type { Board } from '../engine/board';
import type { MoveLog } from '../engine/moveLog';

/** The same deterministic 3x3 board, played to a win, for real metrics. */
const board: Board = {
  id: 'test-3x3',
  width: 3,
  height: 3,
  mines: [[0, 2]],
  startTile: [2, 0],
};

afterEach(cleanup);

/** Play the board to completion and build a Move_Log the engine produced. */
function playToWin(): { state: GameState; log: MoveLog } {
  let state = createGame(board, 0);
  state = applyAction(state, { type: 'Reveal_Click', tile: [2, 0] }, 0);
  // Reveal any still-covered non-mine tiles to force a win deterministically.
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 0 && c === 2) continue; // the mine
      const key = `${r},${c}`;
      if (!state.revealed.has(key)) {
        state = applyAction(state, { type: 'Reveal_Click', tile: [r, c] }, 10);
      }
    }
  }
  const log: MoveLog = {
    boardId: board.id,
    entries: state.moveLog,
    end: { outcome: 'won', endMs: 10 },
  };
  return { state, log };
}

describe('EndSummary', () => {
  it('renders outcome, time, and the metrics from computeMetrics', () => {
    const { log } = playToWin();
    const metrics = computeMetrics(board, log);

    render(
      <EndSummary
        metrics={metrics}
        elapsedMs={65000}
        onPlayAgain={() => {}}
        onHome={() => {}}
      />,
    );

    expect(screen.getByText('You won')).toBeTruthy();
    expect(screen.getByTestId('summary-time').textContent).toBe('1:05');

    // Chording_Efficiency is defined for a won game and matches the metrics.
    const expectedChord =
      metrics.chordingEfficiency === null ? 'n/a' : metrics.chordingEfficiency.toFixed(2);
    expect(screen.getByTestId('summary-chord').textContent).toBe(expectedChord);

    // Logical_Move_Rate field renders the computed value (or n/a).
    const expectedLmr =
      metrics.logicalMoveRate === null ? 'n/a' : `${metrics.logicalMoveRate.toFixed(1)}%`;
    expect(screen.getByTestId('summary-lmr').textContent).toBe(expectedLmr);
  });

  it('shows n/a chording efficiency and a lost label for a lost game', () => {
    const lostMetrics = {
      ...computeMetrics(board, playToWin().log),
      outcome: 'lost' as const,
      chordingEfficiency: null,
    };
    render(
      <EndSummary
        metrics={lostMetrics}
        elapsedMs={0}
        onPlayAgain={() => {}}
        onHome={() => {}}
      />,
    );
    expect(screen.getByText('You lost')).toBeTruthy();
    expect(screen.getByTestId('summary-chord').textContent).toBe('n/a');
  });
});

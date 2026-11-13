import { describe, it, expect } from 'vitest';
import { DIFFICULTIES } from '../engine/board';
import { generate } from '../engine/generator';
import { printBoard } from '../engine/boardFormat';
import { applyAction, type GameState } from '../engine/game';
import {
  DEFAULT_TIME_CAPS_MS,
  buildTestMoveLog,
  computeTestMetrics,
  createTestGame,
  parseEvaluationBoard,
  resolveTimeCapMs,
  studyOutcomeOf,
  toMoveLogOutcome,
} from './studyTestGame';

describe('resolveTimeCapMs (Requirement 22.10)', () => {
  it('uses the configured cap when set and positive', () => {
    expect(resolveTimeCapMs('Beginner', 90_000)).toBe(90_000);
  });

  it('applies the default caps when unset: 4/8/12 minutes', () => {
    expect(resolveTimeCapMs('Beginner', null)).toBe(4 * 60 * 1000);
    expect(resolveTimeCapMs('Intermediate', undefined)).toBe(8 * 60 * 1000);
    expect(resolveTimeCapMs('Expert')).toBe(12 * 60 * 1000);
    expect(DEFAULT_TIME_CAPS_MS.Intermediate).toBe(8 * 60 * 1000);
  });

  it('treats a non-positive or non-finite configured cap as unset', () => {
    expect(resolveTimeCapMs('Beginner', 0)).toBe(4 * 60 * 1000);
    expect(resolveTimeCapMs('Beginner', -5)).toBe(4 * 60 * 1000);
    expect(resolveTimeCapMs('Beginner', Number.NaN)).toBe(4 * 60 * 1000);
  });
});

describe('toMoveLogOutcome (study -> Move_Log outcome)', () => {
  it('maps every study outcome to a Move_Log outcome token', () => {
    expect(toMoveLogOutcome('won')).toBe('won');
    expect(toMoveLogOutcome('lost')).toBe('lost');
    expect(toMoveLogOutcome('Timed_Out')).toBe('timed_out');
    expect(toMoveLogOutcome('Interrupted')).toBe('interrupted');
  });
});

describe('studyOutcomeOf', () => {
  it('reports in-progress as null', () => {
    const board = generate(DIFFICULTIES.Beginner, 1).board;
    const state = createTestGame(board, 0);
    expect(studyOutcomeOf(state)).toBeNull();
  });

  it('reports Timed_Out when the cap is reached and the game is unfinished', () => {
    const board = generate(DIFFICULTIES.Beginner, 1).board;
    const state = createTestGame(board, 0);
    expect(studyOutcomeOf(state, { capReached: true })).toBe('Timed_Out');
  });

  it('reports Interrupted over Timed_Out when interrupted', () => {
    const board = generate(DIFFICULTIES.Beginner, 1).board;
    const state = createTestGame(board, 0);
    expect(studyOutcomeOf(state, { interrupted: true, capReached: true })).toBe('Interrupted');
  });
});

/** Reveal the Start_Tile, then stop (a short, partial game). */
function startAndOnePartialGame(seed: number): { state: GameState; board: ReturnType<typeof generate>['board'] } {
  const g = generate(DIFFICULTIES.Beginner, seed);
  const board = parseEvaluationBoard(printBoard(g.board));
  let state = createTestGame(board, 0);
  // Reveal the Start_Tile at t=0.
  state = applyAction(state, { type: 'Reveal_Click', tile: board.startTile! }, 0);
  return { state, board };
}

describe('Timed_Out metrics come from pre-cap actions only (Requirement 22.9)', () => {
  it('computes metrics from the Move_Log actions made before the cap', () => {
    const { state, board } = startAndOnePartialGame(7);
    // The game is still in progress; simulate reaching the cap.
    const cap = resolveTimeCapMs('Beginner', null);
    const log = buildTestMoveLog(board, state, 'Timed_Out', cap);

    // The Move_Log holds ONLY the actions made before the cap.
    expect(log.entries).toEqual(state.moveLog);
    expect(log.end?.outcome).toBe('timed_out');
    // End time is the cap (never less than the last action time).
    expect(log.end?.endMs).toBe(cap);

    const metrics = computeTestMetrics(board, log);
    // Same Metrics_Engine: it replays exactly the logged actions.
    expect(metrics.totalClicks).toBe(state.moveLog.length);
    // A Timed_Out game is not won, so Chording_Efficiency is null.
    expect(metrics.chordingEfficiency).toBeNull();
    expect(metrics.outcome).not.toBe('won');
  });

  it('an Interrupted game keeps its pre-interruption actions (22.12)', () => {
    const { state, board } = startAndOnePartialGame(9);
    const log = buildTestMoveLog(board, state, 'Interrupted', 1234);
    expect(log.entries).toEqual(state.moveLog);
    expect(log.end?.outcome).toBe('interrupted');
    const metrics = computeTestMetrics(board, log);
    expect(metrics.totalClicks).toBe(state.moveLog.length);
  });
});

/**
 * Pre_Test / Post_Test game logic (task 9.2, Requirement 22).
 *
 * A test game plays a FIXED Evaluation_Board (parsed from the Study_Config's
 * Board_Format text, never generated) as a Timed_Game with EXACTLY ONE attempt
 * (22.8). This module holds the pure, DOM-free pieces so they can be unit
 * tested; the React screen (StudyTestGameScreen.tsx) wires them to input,
 * timing, and persistence.
 *
 * Outcomes (22.9, 22.12): a test game can end not only won/lost but also
 * Timed_Out (reached its time cap) or Interrupted (page reloaded/closed). The
 * engine's own Status is only 'won' | 'lost' (plus in-progress), and the shared
 * GameOutcome in moveLog.ts already includes 'timed_out' and 'interrupted', so
 * we keep the study notion of outcome in THIS module's StudyGameOutcome type
 * and map it onto the Move_Log's End_Entry when serializing — no change to the
 * core engine Status is needed.
 *
 * Time caps (22.10): where a Study_Config sets no cap for a Difficulty, apply
 * 4 min Beginner, 8 min Intermediate, 12 min Expert. When the cap is reached,
 * the game ends Timed_Out and the Game_Metrics are computed from the actions
 * made BEFORE the cap (22.9) — which falls out naturally because the Move_Log
 * only ever contains those actions.
 */

import { parseBoard } from '../engine/boardFormat';
import { numberAt, tileKey, type Board } from '../engine/board';
import { createGame, type GameState } from '../engine/game';
import { computeMetrics, type GameMetrics } from '../engine/metrics';
import type { GameOutcome, MoveLog } from '../engine/moveLog';
import type { Tier } from '../content/lessons';

/** Which test games exist, in play order (22.3, 22.4). */
export type TestPhase = 'Pre_Test' | 'Post_Test';

/** The study-layer outcome of a test game (22.9, 22.11, 22.12). */
export type StudyGameOutcome = 'won' | 'lost' | 'Timed_Out' | 'Interrupted';

/**
 * Default time caps in milliseconds per Difficulty (Requirement 22.10), applied
 * when the Study_Config sets no cap for that Difficulty.
 */
export const DEFAULT_TIME_CAPS_MS: Record<Tier, number> = {
  Beginner: 4 * 60 * 1000,
  Intermediate: 8 * 60 * 1000,
  Expert: 12 * 60 * 1000,
};

/**
 * Resolve the time cap for a test game: the Study_Config's cap for the
 * Difficulty when set, else the Requirement 22.10 default. A non-positive or
 * non-finite configured cap is treated as "unset" and falls back to the default.
 */
export function resolveTimeCapMs(tier: Tier, configuredMs?: number | null): number {
  if (typeof configuredMs === 'number' && Number.isFinite(configuredMs) && configuredMs > 0) {
    return configuredMs;
  }
  return DEFAULT_TIME_CAPS_MS[tier];
}

/** Map a study outcome onto the Move_Log's End_Entry outcome token. */
export function toMoveLogOutcome(outcome: StudyGameOutcome): GameOutcome {
  switch (outcome) {
    case 'won':
      return 'won';
    case 'lost':
      return 'lost';
    case 'Timed_Out':
      return 'timed_out';
    case 'Interrupted':
      return 'interrupted';
  }
}

/**
 * The elapsed ms of the last applied action, used as the game's end time when
 * the game ends by win/loss. For a Timed_Out or Interrupted game the end time
 * is the cap or the interruption moment, computed by the caller.
 */
export function lastActionElapsedMs(state: GameState): number {
  const n = state.moveLog.length;
  return n === 0 ? 0 : state.moveLog[n - 1]!.elapsedMs;
}

/**
 * Derive the study outcome of a test game from the engine state and whether the
 * time cap was reached. A game that the engine has already decided (won/lost)
 * keeps that outcome; otherwise, if the cap was reached it is Timed_Out, and if
 * the page was interrupted it is Interrupted. When none of these hold the game
 * is still in progress and this returns null.
 */
export function studyOutcomeOf(
  state: GameState,
  opts: { capReached?: boolean; interrupted?: boolean } = {},
): StudyGameOutcome | null {
  if (state.status === 'won') return 'won';
  if (state.status === 'lost') return 'lost';
  if (opts.interrupted) return 'Interrupted';
  if (opts.capReached) return 'Timed_Out';
  return null;
}

/**
 * Build the Move_Log for a finished test game. `endMs` is the elapsed ms at
 * which the game ended: the last action's time for win/loss, or the cap /
 * interruption time otherwise (never less than the last action's time, so the
 * Move_Log stays monotonic — 22.9 keeps only pre-cap actions).
 */
export function buildTestMoveLog(
  board: Board,
  state: GameState,
  outcome: StudyGameOutcome,
  endMs: number,
): MoveLog {
  const lastMs = lastActionElapsedMs(state);
  return {
    boardId: board.id,
    entries: state.moveLog,
    end: { outcome: toMoveLogOutcome(outcome), endMs: Math.max(endMs, lastMs) },
  };
}

/**
 * Compute the Game_Metrics for a finished test game from the SAME Metrics_Engine
 * every other game uses (task 9.2 requirement: "Test games use the same
 * Metrics_Engine as every other game"). For a Timed_Out or Interrupted game the
 * Move_Log holds only the actions made before the cap/interruption, so the
 * metrics are computed from exactly those actions (22.9).
 */
export function computeTestMetrics(board: Board, log: MoveLog): GameMetrics {
  return computeMetrics(board, log);
}

/** Parse an Evaluation_Board's Board_Format text into a Board (22.3, 22.4). */
export function parseEvaluationBoard(boardText: string): Board {
  return parseBoard(boardText);
}

/** A fresh GameState for a test game on a parsed Evaluation_Board. */
export function createTestGame(board: Board, now: number): GameState {
  return createGame(board, now);
}

/**
 * The Number shown on a revealed Tile (used by the minimal end screen, which
 * shows only outcome + elapsed, 22.11, so this is here mainly for completeness
 * / reuse by the screen if it needs it). Kept pure.
 */
export function revealedNumber(board: Board, r: number, c: number): number {
  const mineSet = new Set(board.mines.map(([mr, mc]) => tileKey(mr, mc)));
  return numberAt([r, c], board.width, board.height, mineSet);
}

/**
 * The Tutorial_Player engine (task 7.1).
 *
 * Pure game logic, no React or DOM imports, so it runs in tests and tools. It
 * drives one Learn-Then-Do Lesson: the learner reads the Learn_Steps, then works
 * through the Do_Steps, each on its own 5x5 Mini_Board.
 *
 * Do_Step rules (Requirement 11.4-11.8), all enforced here:
 *  - A Logical_Move (a Reveal_Action whose Target_Tiles are all Provably_Safe)
 *    or a Flag_Toggle on a Provably_Mine Tile is applied (11.4).
 *  - A Reveal_Action with a Target_Tile that is not Provably_Safe, or a flag on
 *    a Tile that is not Provably_Mine, is left unapplied; the attempted Tile is
 *    marked and a message explains it cannot yet be proven (11.5).
 *  - When the Objective requires a Chord_Click and the learner reveals a
 *    Target_Tile with a plain Reveal_Click, the Mini_Board resets to its initial
 *    state and the learner is asked to use a chord (11.6).
 *  - The Objective is met when every Target_Tile is revealed; the "next" control
 *    stays disabled until then (11.7, 11.8 are UI concerns driven by
 *    `objectiveMet`).
 *
 * All Solver checks reuse the Follow-Along Practice bridge (`practice.ts`): the
 * same `classifyGame`, `revealTargets`, and `targetsAllSafe`, so the tutorial's
 * notion of "provable" is identical to practice and the metrics.
 *
 * See Requirement 11 and the Design Notes in tasks.md.
 */

import { tileKey, type Board, type Tile } from './board';
import { applyAction, createGame, type Action, type GameState } from './game';
import { parseBoard } from './boardFormat';
import {
  classifyGame,
  isRevealAction,
  revealTargets,
  targetsAllSafe,
} from './practice';
import type { DoStep } from '../content/lessons';

/** Message shown when a reveal/flag is intercepted because a Tile is not proven. */
export const NOT_PROVABLE_MESSAGE =
  'That tile cannot be proven safe or a mine yet. Use the numbers to find a tile you can prove.';

/** Message shown when a chord-Objective step is revealed with a plain click. */
export const USE_CHORD_MESSAGE =
  'Reveal these tiles with a chord click on the number, not one by one. The board has been reset.';

/**
 * The running state of one Do_Step.
 *
 * `game` is the Board_Engine state of the step's Mini_Board. `markedTile` is the
 * last Tile the learner tried that could not be applied (for the error marker,
 * Requirement 11.5); it clears on the next applied action. `wasReset` flags that
 * the board was just reset for a chord Objective (Requirement 11.6).
 */
export interface DoStepState {
  /** The Do_Step this state belongs to. */
  step: DoStep;
  /** The parsed Mini_Board. */
  board: Board;
  /** The Board_Engine state. */
  game: GameState;
  /** The Tile marked as "not provable", or null. */
  markedTile: Tile | null;
  /** True right after a chord-Objective reset (Requirement 11.6). */
  wasReset: boolean;
}

/** The result of applying a learner action to a Do_Step. */
export interface DoStepResult {
  state: DoStepState;
  /** A learner-facing message, or null when the action applied cleanly. */
  message: string | null;
}

/** Create the initial state for a Do_Step from its authored Board_Format text. */
export function createDoStepState(step: DoStep): DoStepState {
  const board = parseBoard(step.boardText);
  return {
    step,
    board,
    game: createGame(board, 0),
    markedTile: null,
    wasReset: false,
  };
}

/** The Target_Tiles of a Do_Step as `"row,col"` keys. */
function targetKeys(step: DoStep): Set<string> {
  return new Set(step.targets.map(([r, c]) => tileKey(r, c)));
}

/**
 * True when the Do_Step's Objective is met: every Target_Tile is revealed in the
 * current game (Requirement 11.8). A `chord` Objective additionally requires the
 * Target_Tiles to have been revealed by a Chord_Click, which the pipeline
 * enforces by resetting on a plain reveal (Requirement 11.6); once reset is
 * handled, "all targets revealed" is the completion condition for both kinds.
 */
export function objectiveMet(state: DoStepState): boolean {
  const keys = targetKeys(state.step);
  for (const key of keys) {
    if (!state.game.revealed.has(key)) return false;
  }
  return keys.size > 0;
}

/** True when `tile` is one of the Do_Step's Target_Tiles. */
function isTarget(step: DoStep, tile: Tile): boolean {
  return step.targets.some(([r, c]) => r === tile[0] && c === tile[1]);
}

/**
 * Whether a Flag_Toggle is allowed: the flagged Tile must be Provably_Mine
 * (Requirement 11.4/11.5). Removing an existing flag is always allowed (it never
 * marks a non-mine Tile as a mine). Returns true when the toggle may be applied.
 */
function flagAllowed(state: DoStepState, tile: Tile): boolean {
  const key = tileKey(tile[0], tile[1]);
  // Un-flagging is always fine.
  if (state.game.flags.has(key)) return true;
  const result = classifyGame(state.game);
  if (result.inexact || result.inconsistent) return false;
  return result.classification.get(key) === 'Provably_Mine';
}

/**
 * Apply a learner action to a Do_Step and return the next state plus any
 * message. The input state is never mutated.
 *
 * This is the single entry point the Tutorial_Player UI calls for every gesture
 * on a Do_Step board.
 */
export function applyDoStepAction(state: DoStepState, action: Action): DoStepResult {
  const { game, step } = state;

  // A finished step takes no more actions.
  if (game.status === 'won' || game.status === 'lost') {
    return { state: { ...state, wasReset: false }, message: null };
  }

  // ---- Flag_Toggle: allowed only on a Provably_Mine Tile (11.4/11.5) ----
  if (action.type === 'Flag_Toggle') {
    if (flagAllowed(state, action.tile)) {
      const nextGame = applyAction(game, action, 0);
      return {
        state: { ...state, game: nextGame, markedTile: null, wasReset: false },
        message: null,
      };
    }
    return {
      state: { ...state, markedTile: action.tile, wasReset: false },
      message: NOT_PROVABLE_MESSAGE,
    };
  }

  // ---- Reveal actions (Reveal_Click / Chord_Click) ----
  if (isRevealAction(action)) {
    const targets = revealTargets(game, action);

    // A chord that changes nothing (unsatisfied / nothing to reveal): apply so
    // the engine records the Wasted_Click; no interception, no message.
    if (targets.length === 0) {
      const nextGame = applyAction(game, action, 0);
      return {
        state: { ...state, game: nextGame, wasReset: false },
        message: null,
      };
    }

    // Chord-Objective guard (11.6): if this step must be solved with a chord and
    // the learner used a plain Reveal_Click on a Target_Tile, reset the board
    // and ask for a chord.
    if (
      step.objective === 'chord' &&
      action.type === 'Reveal_Click' &&
      isTarget(step, action.tile)
    ) {
      return {
        state: {
          ...state,
          game: createGame(state.board, 0),
          markedTile: null,
          wasReset: true,
        },
        message: USE_CHORD_MESSAGE,
      };
    }

    // Logical_Move check (11.4/11.5): every Target_Tile must be Provably_Safe.
    const result = classifyGame(game);
    const allSafe = !result.inexact && !result.inconsistent && targetsAllSafe(targets, result);
    if (allSafe) {
      const nextGame = applyAction(game, action, 0);
      return {
        state: { ...state, game: nextGame, markedTile: null, wasReset: false },
        message: null,
      };
    }

    // Intercept: leave the board unchanged and mark the attempted Tile.
    return {
      state: { ...state, markedTile: action.tile, wasReset: false },
      message: NOT_PROVABLE_MESSAGE,
    };
  }

  // Any other action type: pass through unchanged.
  return { state: { ...state, wasReset: false }, message: null };
}

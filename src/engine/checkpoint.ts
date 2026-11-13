/**
 * The Mastery_Checkpoint engine (task 7.2).
 *
 * Pure engine logic, no React or DOM imports, so it runs in tests and tools. It
 * drives the unassisted test at the end of each Difficulty's tutorial: the
 * learner clears Checkpoint_Variations (small logical Mini_Boards) one at a
 * time, and passes after three in a row with no Slip (Requirement 13).
 *
 * Rules enforced here (Requirement 13.1-13.6):
 *  - 13.1 A Checkpoint_Variation is presented one at a time, with no Overlays,
 *    Nudges, or explanations — this engine carries none, so the UI has nothing
 *    to draw beyond the bare board.
 *  - 13.2 Clearing every non-mine Tile of a variation without a Slip bumps the
 *    consecutive-success count by one and presents the next variation.
 *  - 13.3 A Slip (a Guess — a Reveal_Action with a Target_Tile that is not
 *    Provably_Safe — or a Wrong_Flag — a flag on a Tile that is not
 *    Provably_Mine) leaves the action unapplied, marks the slipped Tile on the
 *    board where it happened, resets the consecutive-success count to zero, and
 *    presents a new variation. The marking and the new board are two steps:
 *    the Slip sets `slippedTile` and `pendingReset` on the failed board (so the
 *    UI flashes the error indicator), and `advanceAfterSlip` — called by the UI
 *    after the brief marker, and implicitly by the next action — swaps in a
 *    fresh, different variation.
 *  - 13.4 When the count reaches three, the checkpoint is recorded passed.
 *  - 13.6 Variations are drawn from a pool of at least six per Difficulty, and
 *    the next variation is different from the one just played.
 *
 * "Provably_Safe" and "Provably_Mine" are decided by the Solver through the same
 * `classifyGame`/`revealTargets`/`targetsAllSafe` bridge Practice and the
 * Tutorial_Player use, so the checkpoint's notion of a Slip matches the metrics
 * and the rest of the platform exactly.
 *
 * Variation selection is deterministic given a seed so tests and the Content_
 * Validator stay reproducible: the engine takes a `nextIndex(pool, exclude)`
 * chooser, defaulting to a small seeded picker.
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
import type { CheckpointVariation } from '../content/checkpoints';

/** Consecutive unassisted clears required to pass a Mastery_Checkpoint. */
export const REQUIRED_STREAK = 3;

/** Message shown when a Slip (Guess or Wrong_Flag) is intercepted (13.3). */
export const SLIP_MESSAGE =
  'That was a slip — the move was not provable. Your streak resets; here is a fresh board.';

/**
 * A chooser for the next Checkpoint_Variation. Given the tier's pool and the id
 * just played (or null at the start), it returns the index in `pool` to play
 * next. The default keeps tests deterministic.
 */
export type VariationChooser = (
  pool: CheckpointVariation[],
  excludeId: string | null,
) => number;

/**
 * The running state of a Mastery_Checkpoint.
 *
 * `pool` is the tier's Checkpoint_Variations (Requirement 13.6). `current` is
 * the variation on screen and `game` its Board_Engine state. `streak` is the
 * consecutive-success count (0..3). `markedTile` is the last slipped Tile, for
 * the error indicator (13.3); it clears on the next applied action. `passed`
 * latches true when the streak reaches three (13.4).
 */
export interface CheckpointState {
  /** The tier's variation pool. */
  pool: CheckpointVariation[];
  /** The variation currently presented. */
  current: CheckpointVariation;
  /** Board_Engine state of the current variation. */
  game: GameState;
  /** Consecutive clears with no Slip, 0..REQUIRED_STREAK. */
  streak: number;
  /**
   * The Tile of the most recent Slip, for the error indicator (13.3). It names
   * the Tile the learner just slipped on (on the current, failed board), so the
   * UI can flash a brief error marker. Null after any cleanly applied action
   * and after the new variation is presented.
   */
  slippedTile: Tile | null;
  /**
   * True right after a Slip: the current board is the failed one with
   * `slippedTile` marked, and the next action (or `advanceAfterSlip`) presents a
   * fresh, different variation (13.3).
   */
  pendingReset: boolean;
  /** True once the checkpoint is passed (13.4). */
  passed: boolean;
  /** How the current variation was chosen, for the next exclude. */
  currentId: string;
  /** The chooser used to advance variations. */
  choose: VariationChooser;
}

/** The result of applying a learner action to a checkpoint. */
export interface CheckpointResult {
  state: CheckpointState;
  /** A learner-facing message, or null when the action applied cleanly. */
  message: string | null;
}

/**
 * A tiny deterministic chooser: picks the first variation whose id differs from
 * `excludeId`, offset by a seed so a session does not always start on the same
 * board. With a pool of six this visits them in a fixed rotation and never
 * repeats the one just played (Requirement 13.6).
 */
export function seededChooser(seed: number): VariationChooser {
  let counter = Math.abs(Math.trunc(seed));
  return (pool, excludeId) => {
    const n = pool.length;
    if (n === 0) return 0;
    for (let step = 0; step < n; step++) {
      const idx = (counter + step) % n;
      if (pool[idx].id !== excludeId) {
        counter = (idx + 1) % n;
        return idx;
      }
    }
    // Pool of one (should not happen with six): return it.
    return counter % n;
  };
}

/** Parse a variation's Board_Format text into a fresh GameState. */
function gameForVariation(v: CheckpointVariation): GameState {
  const board: Board = parseBoard(v.boardText);
  return createGame(board, 0);
}

/**
 * Start a Mastery_Checkpoint over a tier's variation pool. The pool must hold at
 * least two variations so a reset can present a different board; the content
 * tests guarantee six per tier (Requirement 13.6).
 */
export function createCheckpoint(
  pool: CheckpointVariation[],
  chooser: VariationChooser = seededChooser(0),
): CheckpointState {
  if (pool.length === 0) {
    throw new Error('A Mastery_Checkpoint needs at least one Checkpoint_Variation.');
  }
  const idx = chooser(pool, null);
  const current = pool[idx];
  return {
    pool,
    current,
    game: gameForVariation(current),
    streak: 0,
    slippedTile: null,
    pendingReset: false,
    passed: false,
    currentId: current.id,
    choose: chooser,
  };
}

/** Move to a fresh variation (different from the current), keeping the streak. */
function presentNext(state: CheckpointState, keepStreak: number): CheckpointState {
  const idx = state.choose(state.pool, state.currentId);
  const current = state.pool[idx];
  return {
    ...state,
    current,
    game: gameForVariation(current),
    streak: keepStreak,
    slippedTile: null,
    pendingReset: false,
    currentId: current.id,
  };
}

/**
 * Whether a Flag_Toggle is a Wrong_Flag: a flag placed on a Tile that is not
 * Provably_Mine (glossary Wrong_Flag, Slip). Removing an existing flag is never
 * a Slip. Returns true when the toggle is a Slip and must be intercepted.
 */
function isWrongFlag(game: GameState, tile: Tile): boolean {
  const key = tileKey(tile[0], tile[1]);
  // Un-flagging is always fine.
  if (game.flags.has(key)) return false;
  const result = classifyGame(game);
  // In an Inexact_State we cannot prove the Tile a mine, so a flag there is a
  // Slip (the checkpoint boards are all exactly solvable, so this is defensive).
  if (result.inexact || result.inconsistent) return true;
  return result.classification.get(key) !== 'Provably_Mine';
}

/**
 * Apply a learner action to a Mastery_Checkpoint and return the next state plus
 * any message. The input state is never mutated.
 *
 * This is the single entry point the Mastery_Checkpoint UI calls for every
 * gesture on the current variation board.
 */
export function applyCheckpointAction(
  state: CheckpointState,
  action: Action,
): CheckpointResult {
  // A passed checkpoint takes no more actions.
  if (state.passed) return { state, message: null };

  // After a Slip the failed board is still shown with its error marker. The
  // next action first presents the fresh variation (13.3), then is discarded —
  // one gesture clears the marker and moves on, it does not also play on the new
  // board (which the learner has not yet seen).
  if (state.pendingReset) {
    return { state: advanceAfterSlip(state), message: null };
  }

  const { game } = state;

  // A finished variation takes no more actions until the next is presented
  // (which this engine does synchronously on the clearing action below).
  if (game.status === 'won' || game.status === 'lost') {
    return { state, message: null };
  }

  // ---- Flag_Toggle: a flag on a non-Provably_Mine Tile is a Wrong_Flag (13.3) ----
  if (action.type === 'Flag_Toggle') {
    if (isWrongFlag(game, action.tile)) {
      return { state: slip(state, action.tile), message: SLIP_MESSAGE };
    }
    const nextGame = applyAction(game, action, 0);
    return {
      state: { ...state, game: nextGame, slippedTile: null, pendingReset: false },
      message: null,
    };
  }

  // ---- Reveal actions (Reveal_Click / Chord_Click) ----
  if (isRevealAction(action)) {
    const targets = revealTargets(game, action);

    // A chord that changes nothing is a Wasted_Click: apply it so the engine
    // logs it; it is not a Slip (it reveals nothing).
    if (targets.length === 0) {
      const nextGame = applyAction(game, action, 0);
      return { state: { ...state, game: nextGame }, message: null };
    }

    // A Guess is a Reveal_Action with a Target_Tile that is not Provably_Safe
    // (glossary Guess, Slip). Intercept it (13.3).
    const result = classifyGame(game);
    const allSafe =
      !result.inexact && !result.inconsistent && targetsAllSafe(targets, result);
    if (!allSafe) {
      return { state: slip(state, action.tile), message: SLIP_MESSAGE };
    }

    // Logical_Move: apply it. If it clears the board, bump the streak and,
    // unless the checkpoint is now passed, present the next variation (13.2).
    const nextGame = applyAction(game, action, 0);
    if (nextGame.status === 'won') {
      const newStreak = state.streak + 1;
      if (newStreak >= REQUIRED_STREAK) {
        // Passed: keep the cleared board on screen and latch `passed` (13.4).
        return {
          state: {
            ...state,
            game: nextGame,
            streak: newStreak,
            slippedTile: null,
            pendingReset: false,
            passed: true,
          },
          message: null,
        };
      }
      // Cleared but not yet passed: present a fresh, different variation (13.2).
      return {
        state: presentNext({ ...state, slippedTile: null }, newStreak),
        message: null,
      };
    }

    // Applied, board not yet cleared.
    return {
      state: { ...state, game: nextGame, slippedTile: null, pendingReset: false },
      message: null,
    };
  }

  // Any other action type: pass through unchanged.
  return { state, message: null };
}

/**
 * Handle a Slip: leave the action unapplied, mark the slipped Tile on the
 * current (failed) board, reset the streak to zero, and arm the reset so the
 * next action presents a fresh variation (Requirement 13.3). The board itself is
 * untouched — the slipped reveal/flag is never applied.
 */
function slip(state: CheckpointState, tile: Tile): CheckpointState {
  return {
    ...state,
    streak: 0,
    slippedTile: tile,
    pendingReset: true,
  };
}

/**
 * Present a fresh, different Checkpoint_Variation after a Slip (Requirement
 * 13.3). The UI calls this after flashing the error marker; it is also applied
 * implicitly by the next action. A no-op when no reset is pending.
 */
export function advanceAfterSlip(state: CheckpointState): CheckpointState {
  if (!state.pendingReset) return state;
  return presentNext(state, 0);
}

/** True when every non-mine Tile of the current variation is revealed. */
export function variationCleared(state: CheckpointState): boolean {
  return state.game.status === 'won';
}

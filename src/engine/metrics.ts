/**
 * The Metrics_Engine: the one place Game_Metrics are computed.
 *
 * It takes only a Board and a Move_Log and replays the game with the
 * Board_Engine, so the learner summary, the leaderboard record, and the study
 * outcome measures all come from the same code and the same stored data
 * (Requirement 9). It is pure and deterministic: computing the metrics twice on
 * the same Board and Move_Log gives identical results.
 *
 * What it computes (Requirement 8):
 *  - Logical_Move_Rate: 100 x Logical_Moves / Counted_Reveal_Actions, to one
 *    decimal place. A Counted_Reveal_Action is a Reveal_Action other than the
 *    Start_Tile reveal and other than one taken in an Inexact_State. A
 *    Reveal_Action is a Logical_Move when all of its Target_Tiles were
 *    Provably_Safe in the Board_State immediately before the action. Reported
 *    as not-available (null) when there are no Counted_Reveal_Actions.
 *  - Chording_Efficiency: Total_Clicks / 3BV, to two decimal places, for WON
 *    games only (null otherwise); Total_Clicks and 3BV are always reported.
 *  - Click counts by type, Guess count, Wrong_Flag count.
 *  - `partial`: true when any Reveal_Action was taken in an Inexact_State, with
 *    the count of Reveal_Actions excluded for that reason.
 *
 * Pattern_Recognition_Speed (Requirement 8.7-8.9): for each Pattern_Type, the
 * median seconds from a Pattern_Instance's appearance to its resolution, over
 * that type's resolved instances that are neither excluded nor superseded,
 * rounded to one decimal place; not-available (null) when the type has no such
 * instance. Per-type counts of resolved, excluded, superseded, and unresolved
 * instances are reported too. These come from the Pattern_Detector, which
 * replays the same Board and Move_Log, so assessment and evaluation stay
 * identical by construction.
 *
 * See the Design Notes in tasks.md and Requirements 7, 8, and 9.
 */

import { neighbors, numberAt, tileKey, type Board, type Tile } from './board';
import {
  applyAction,
  createGame,
  type Action,
  type GameState,
} from './game';
import { classify, type BoardState } from './solver';
import { threeBV } from './threeBV';
import type { MoveLog } from './moveLog';
import {
  detectPatternInstances,
  type PatternInstance,
  type PatternType,
} from './patterns';

/**
 * Metrics_Version: the version of these definitions. Bump it whenever a change
 * would alter the Game_Metrics produced for a given Board and Move_Log, so
 * stored results stay tied to the code that produced them.
 *
 * v2 adds Pattern_Recognition_Speed and per-Pattern_Type instance counts.
 */
export const METRICS_VERSION = 2;

/** The eight Pattern_Types, in catalog order. */
const PATTERN_TYPES: readonly PatternType[] = [
  'Exposed_Mines',
  'Satisfied_Number',
  'Wall_1_1',
  'Wall_1_2_1',
  'Wall_1_2_2_1',
  'Subset',
  'Clue_Chain',
  'Mine_Count_Endgame',
];

/** Per-Pattern_Type instance counts (Requirement 8.9). */
export interface PatternInstanceCounts {
  resolved: number;
  excluded: number;
  superseded: number;
  unresolved: number;
}

/**
 * Pattern_Recognition_Speed for one Pattern_Type (Requirement 8.7-8.9): the
 * median seconds to one decimal place (null when not available), plus the
 * per-status instance counts.
 */
export interface PatternSpeed {
  /** Median seconds from appearance to resolution, or null if not available. */
  medianSeconds: number | null;
  counts: PatternInstanceCounts;
}

/** Counts of each Player_Action type plus the derived counts. */
export interface ClickCounts {
  revealClicks: number;
  flagToggles: number;
  chordClicks: number;
  /** Chord_Clicks that changed nothing. */
  wastedClicks: number;
}

/** The Game_Metrics for one game. */
export interface GameMetrics {
  /** The version of the definitions that produced these metrics. */
  metricsVersion: number;
  /** The Board identifier the game was played on. */
  boardId: string;
  /**
   * Logical_Move_Rate as a percentage to one decimal place, or null when the
   * game has no Counted_Reveal_Actions.
   */
  logicalMoveRate: number | null;
  /** The number of Counted_Reveal_Actions that were Logical_Moves. */
  logicalMoves: number;
  /** The number of Counted_Reveal_Actions (the denominator of the rate). */
  countedReveals: number;
  /** Guesses: Counted_Reveal_Actions that were not Logical_Moves. */
  guesses: number;
  /** Flags placed on Tiles that were not Provably_Mine when placed. */
  wrongFlags: number;
  /** Every Player_Action in the Move_Log, including Wasted_Clicks. */
  totalClicks: number;
  /** The Board's 3BV. */
  threeBV: number;
  /**
   * Chording_Efficiency (Total_Clicks / 3BV) to two decimal places for WON
   * games, or null when the game was not won (or 3BV is zero).
   */
  chordingEfficiency: number | null;
  /** Per-type click counts. */
  clickCounts: ClickCounts;
  /** True when any Reveal_Action was taken in an Inexact_State. */
  partial: boolean;
  /** How many Reveal_Actions were excluded because the state was inexact. */
  excludedForInexact: number;
  /** The game's final outcome, taken from the replay. */
  outcome: GameState['status'];
  /**
   * Pattern_Recognition_Speed and instance counts for every Pattern_Type
   * (Requirement 8.7-8.9). Every Pattern_Type is present; `medianSeconds` is
   * null when that type has no resolved, non-excluded, non-superseded instance.
   */
  patternSpeed: Record<PatternType, PatternSpeed>;
}

/** Round to `digits` decimal places, avoiding sign-of-zero and -0 artifacts. */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** The median of a non-empty sorted-or-unsorted list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute Pattern_Recognition_Speed and the per-status instance counts for
 * every Pattern_Type from the detected Pattern_Instances (Requirement 8.7-8.9).
 *
 * The median is taken over resolved instances that are neither excluded nor
 * superseded (a resolved instance is, by its status, already neither of those).
 * `medianSeconds` is null when a type has no such instance.
 */
function patternSpeedFrom(instances: PatternInstance[]): Record<PatternType, PatternSpeed> {
  const out = {} as Record<PatternType, PatternSpeed>;
  for (const type of PATTERN_TYPES) {
    out[type] = {
      medianSeconds: null,
      counts: { resolved: 0, excluded: 0, superseded: 0, unresolved: 0 },
    };
  }

  const durationsByType = new Map<PatternType, number[]>();
  for (const inst of instances) {
    const slot = out[inst.patternType];
    slot.counts[inst.status]++;
    if (inst.status === 'resolved' && inst.resolutionMs !== null) {
      const seconds = (inst.resolutionMs - inst.appearanceMs) / 1000;
      const list = durationsByType.get(inst.patternType) ?? [];
      list.push(seconds);
      durationsByType.set(inst.patternType, list);
    }
  }

  for (const [type, durations] of durationsByType) {
    if (durations.length > 0) {
      out[type].medianSeconds = round(median(durations), 1);
    }
  }

  return out;
}

/** The mine set of a Board as a `"row,col"` key set. */
function mineSetOf(board: Board): Set<string> {
  return new Set(board.mines.map(([r, c]) => tileKey(r, c)));
}

/**
 * Build the Solver's BoardState from a GameState. The Solver reads only the
 * revealed Numbers and the total mine count; flags are intentionally left out.
 */
function solverStateOf(state: GameState): BoardState {
  const { board } = state;
  const mineSet = mineSetOf(board);
  const revealed: Array<{ tile: Tile; number: number }> = [];
  for (const key of state.revealed) {
    const comma = key.indexOf(',');
    const r = Number(key.slice(0, comma));
    const c = Number(key.slice(comma + 1));
    revealed.push({ tile: [r, c], number: numberAt([r, c], board.width, board.height, mineSet) });
  }
  return { width: board.width, height: board.height, mineCount: board.mines.length, revealed };
}

/**
 * The Target_Tiles of a Reveal_Action in a given Board_State: the clicked Tile
 * for a Reveal_Click, and the covered, unflagged Neighbors of the Number for a
 * Chord_Click. Returns the covered targets only (an already-revealed clicked
 * Tile yields none, which the caller treats as "not a Reveal_Action").
 */
function targetTiles(state: GameState, action: Action): Tile[] {
  const { board } = state;
  if (action.type === 'Reveal_Click') {
    const key = tileKey(action.tile[0], action.tile[1]);
    if (state.revealed.has(key) || state.flags.has(key)) return [];
    return [action.tile];
  }
  if (action.type === 'Chord_Click') {
    const key = tileKey(action.tile[0], action.tile[1]);
    if (!state.revealed.has(key)) return [];
    const mineSet = mineSetOf(board);
    const number = numberAt(action.tile, board.width, board.height, mineSet);
    let flagged = 0;
    const covered: Tile[] = [];
    for (const nb of neighbors(action.tile, board.width, board.height)) {
      const nk = tileKey(nb[0], nb[1]);
      if (state.flags.has(nk)) flagged++;
      else if (!state.revealed.has(nk)) covered.push(nb);
    }
    // A Chord_Click only reveals when the flag count matches the Number.
    if (flagged !== number) return [];
    return covered;
  }
  return [];
}

/**
 * Compute the Game_Metrics for a game from only its Board and Move_Log.
 *
 * The Move_Log is replayed with the Board_Engine. For each Reveal_Action, the
 * Solver classifies the Board_State immediately before the action; the action
 * is a Logical_Move when all of its Target_Tiles are Provably_Safe. Reveal
 * Actions taken in an Inexact_State are excluded and mark the metrics partial.
 */
export function computeMetrics(board: Board, log: MoveLog): GameMetrics {
  let state = createGame(board, 0);

  const clickCounts: ClickCounts = {
    revealClicks: 0,
    flagToggles: 0,
    chordClicks: 0,
    wastedClicks: 0,
  };

  let logicalMoves = 0;
  let countedReveals = 0;
  let guesses = 0;
  let wrongFlags = 0;
  let totalClicks = 0;
  let partial = false;
  let excludedForInexact = 0;

  for (const entry of log.entries) {
    const action: Action = { type: entry.type, tile: entry.tile };

    // The Target_Tiles and solver view are read from the Board_State *before*
    // the action is applied.
    const before = state;
    const isStartReveal = !before.startRevealed;

    // Classify a Reveal_Action (a Reveal_Click, or a revealing Chord_Click)
    // before applying it. The Start_Tile reveal is never counted.
    let targets: Tile[] = [];
    if (!isStartReveal && (action.type === 'Reveal_Click' || action.type === 'Chord_Click')) {
      targets = targetTiles(before, action);
    }

    // Wrong_Flag: a flag placed on a Tile that was not Provably_Mine when
    // placed. Only a flag *placement* (not removal) on a covered Tile counts.
    if (action.type === 'Flag_Toggle' && before.startRevealed) {
      const key = tileKey(action.tile[0], action.tile[1]);
      const placing = !before.flags.has(key) && !before.revealed.has(key);
      if (placing) {
        const result = classify(solverStateOf(before));
        const cls = result.classification.get(key);
        if (cls !== 'Provably_Mine') wrongFlags++;
      }
    }

    // A Reveal_Action is a Reveal_Click or a Chord_Click that reveals >=1 Tile.
    if (targets.length > 0) {
      const result = classify(solverStateOf(before));
      if (result.inexact) {
        // Excluded from Logical_Move_Rate and marks the metrics partial.
        partial = true;
        excludedForInexact++;
      } else {
        countedReveals++;
        const allSafe = targets.every(
          (t) => result.classification.get(tileKey(t[0], t[1])) === 'Provably_Safe',
        );
        if (allSafe) logicalMoves++;
        else guesses++;
      }
    }

    // Apply the action and count the click. `now` uses the entry's elapsed ms so
    // the replayed Move_Log matches the original timing.
    state = applyAction(before, action, entry.elapsedMs);

    // Count every applied Player_Action toward Total_Clicks and its type.
    totalClicks++;
    if (action.type === 'Reveal_Click') clickCounts.revealClicks++;
    else if (action.type === 'Flag_Toggle') clickCounts.flagToggles++;
    else if (action.type === 'Chord_Click') {
      clickCounts.chordClicks++;
      const last = state.moveLog[state.moveLog.length - 1];
      if (last && last.wastedClick) clickCounts.wastedClicks++;
    }
  }

  const bv = threeBV(board);
  const logicalMoveRate =
    countedReveals === 0 ? null : round((100 * logicalMoves) / countedReveals, 1);
  const chordingEfficiency =
    state.status === 'won' && bv > 0 ? round(totalClicks / bv, 2) : null;

  // Pattern_Recognition_Speed and per-type instance counts come from the
  // Pattern_Detector replaying the same Board and Move_Log (Requirement 8.7-8.9).
  const patternSpeed = patternSpeedFrom(detectPatternInstances(board, log));

  return {
    metricsVersion: METRICS_VERSION,
    boardId: log.boardId,
    logicalMoveRate,
    logicalMoves,
    countedReveals,
    guesses,
    wrongFlags,
    totalClicks,
    threeBV: bv,
    chordingEfficiency,
    clickCounts,
    partial,
    excludedForInexact,
    outcome: state.status,
    patternSpeed,
  };
}

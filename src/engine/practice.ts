/**
 * Follow-Along Practice engine and the two-stage Nudge (task 5).
 *
 * Pure logic, no React or DOM imports, so it runs in tests and (if needed) a
 * Worker. The Practice_Mode plays a No_Guess_Board untimed. Before applying a
 * Reveal_Click or a revealing Chord_Click it asks the Solver to classify the
 * current Board_State. If every Target_Tile is Provably_Safe the action is
 * applied; otherwise the action is intercepted (left unapplied) and the
 * Hint_Coach produces a Nudge that points the learner toward the numbers to
 * compare without revealing, flagging, or marking any covered Tile.
 *
 * The Nudge has two stages:
 *  - Stage 1 outlines the Hint_Region: the bounding box of the Hint_Target's
 *    Anchor_Numbers and their covered Neighbors.
 *  - Stage 2 keeps that outline and also highlights the Anchor_Numbers (and the
 *    mine counter for a Mine_Count deduction).
 *
 * Guardrail (Requirement 14.8): building or showing a Nudge never reveals,
 * flags, or individually marks the Hint_Target or any other covered Tile. The
 * only thing a Nudge touches is overlay geometry (a region box and the
 * coordinates of the Anchor_Numbers), never the Board_State.
 *
 * See Requirement 14 and the Design Notes in tasks.md.
 */

import {
  neighbors,
  numberAt,
  tileKey,
  type Board,
  type Tile,
} from './board';
import {
  applyAction,
  createGame,
  type Action,
  type GameState,
} from './game';
import {
  classify,
  type BoardState,
  type SolveResult,
} from './solver';

/** The least reasoning that proves a Tile safe, used to break Hint_Target ties. */
export type DeductionLevel =
  | 'Single_Clue'
  | 'Pair_Clue'
  | 'Multi_Clue'
  | 'Mine_Count';

/** Rank of each Deduction_Level, lowest first (for tie-breaking). */
const DEDUCTION_RANK: Record<DeductionLevel, number> = {
  Single_Clue: 0,
  Pair_Clue: 1,
  Multi_Clue: 2,
  Mine_Count: 3,
};

/** Which stage of the Nudge is shown. */
export type NudgeStage = 1 | 2;

/** An inclusive bounding box of Tiles: rows `[top, bottom]`, cols `[left, right]`. */
export interface Region {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * A Nudge: the Hint_Coach's response to an intercepted Reveal_Action.
 *
 * It carries only overlay geometry. It never carries an instruction to change
 * the Board_State. The Board_View draws the `region` outline always, and the
 * `anchors` highlights plus `needsMineCount` only at stage 2.
 */
export interface Nudge {
  /** 1 (region outline only) or 2 (outline + anchor highlights). */
  stage: NudgeStage;
  /** The Provably_Safe Tile the Nudge is built around; never marked itself. */
  hintTarget: Tile;
  /** The smallest set of revealed Numbers that proves the Hint_Target safe. */
  anchors: Tile[];
  /** The bounding box of the anchors and their covered Neighbors. */
  region: Region;
  /** The Deduction_Level that proves the Hint_Target. */
  deductionLevel: DeductionLevel;
  /** True when the total mine count was needed (stage 2 highlights the counter). */
  needsMineCount: boolean;
}

/**
 * Practice session state: a GameState plus the running Nudge and counters shown
 * when the Board is cleared (Requirement 14.11).
 */
export interface PracticeState {
  /** The underlying Board_Engine state. */
  game: GameState;
  /** The Nudge currently on screen, or null when none is shown. */
  nudge: Nudge | null;
  /** Count of intercepted Reveal_Actions this session. */
  interceptedCount: number;
  /** Count of stage-2 Nudges reached this session. */
  stage2Count: number;
}

/** The result of applying a practice action. */
export interface PracticeResult {
  state: PracticeState;
  /** A learner-facing message to show, or null when the action applied. */
  message: string | null;
}

/** Message shown when a Reveal_Action is intercepted because a Tile is not safe. */
export const NOT_PROVABLE_MESSAGE =
  'That tile cannot be proven safe yet. Compare the highlighted numbers to find a safe tile.';

/** Message shown in an Inexact_State when a Reveal_Action would reveal a mine. */
export const INEXACT_BLOCKED_MESSAGE =
  'This position is too complex to verify right now, and that move would hit a mine. Try a different tile.';

/**
 * Build a fresh PracticeState from a Board. Practice is untimed, so the
 * underlying GameState uses a fixed timestamp of 0; elapsed times in the
 * Move_Log are not meaningful here and are never shown.
 */
export function createPractice(board: Board): PracticeState {
  return {
    game: createGame(board, 0),
    nudge: null,
    interceptedCount: 0,
    stage2Count: 0,
  };
}

// ---------------------------------------------------------------------------
// Solver bridge
// ---------------------------------------------------------------------------

/**
 * Build the Solver's BoardState from a GameState. The Solver reasons only from
 * revealed Numbers and the total mine count; flags are intentionally omitted.
 */
export function boardStateOf(game: GameState): BoardState {
  const { board } = game;
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
  const revealed: Array<{ tile: Tile; number: number }> = [];
  for (const key of game.revealed) {
    const [r, c] = parseKey(key);
    // A revealed mine (only present after a loss) is not a Number tile.
    if (mineSet.has(key)) continue;
    revealed.push({
      tile: [r, c],
      number: numberAt([r, c], board.width, board.height, mineSet),
    });
  }
  return {
    width: board.width,
    height: board.height,
    mineCount: board.mines.length,
    revealed,
  };
}

/** Classify the current Board_State of a GameState. */
export function classifyGame(game: GameState, stepBudget?: number): SolveResult {
  return classify(boardStateOf(game), stepBudget);
}

// ---------------------------------------------------------------------------
// Reveal-action target tiles
// ---------------------------------------------------------------------------

/** True for an action that could reveal Tiles (Reveal_Click or Chord_Click). */
export function isRevealAction(action: Action): boolean {
  return action.type === 'Reveal_Click' || action.type === 'Chord_Click';
}

/**
 * The Target_Tiles of a Reveal_Action in the current GameState.
 *
 * For a Reveal_Click: the clicked Tile, when it is covered and unflagged.
 * For a Chord_Click on a revealed Number whose flagged-Neighbor count equals
 * the Number: its covered, unflagged Neighbors. Any other action, or a chord
 * that would change nothing, yields an empty list.
 */
export function revealTargets(game: GameState, action: Action): Tile[] {
  const { board } = game;
  const { width, height } = board;
  const [r, c] = action.tile;
  const key = tileKey(r, c);

  if (action.type === 'Reveal_Click') {
    if (game.revealed.has(key) || game.flags.has(key)) return [];
    return [[r, c]];
  }

  if (action.type === 'Chord_Click') {
    if (!game.revealed.has(key)) return [];
    const mineSet = new Set(board.mines.map(([mr, mc]) => tileKey(mr, mc)));
    const number = numberAt([r, c], width, height, mineSet);
    let flagged = 0;
    const covered: Tile[] = [];
    for (const nb of neighbors([r, c], width, height)) {
      const nk = tileKey(nb[0], nb[1]);
      if (game.flags.has(nk)) flagged++;
      else if (!game.revealed.has(nk)) covered.push(nb);
    }
    // Only a satisfied chord with something to reveal has Target_Tiles.
    if (flagged !== number || covered.length === 0) return [];
    return covered;
  }

  return [];
}

/** True when every Target_Tile of the action is Provably_Safe in `result`. */
export function targetsAllSafe(
  targets: Tile[],
  result: SolveResult,
): boolean {
  if (targets.length === 0) return false;
  for (const [r, c] of targets) {
    if (result.classification.get(tileKey(r, c)) !== 'Provably_Safe') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Hint_Target selection
// ---------------------------------------------------------------------------

/** Chebyshev distance between two Tiles. */
function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/**
 * Choose the Hint_Target: the Provably_Safe Tile nearest the intercepted Tile
 * by Chebyshev distance, breaking ties by lowest Deduction_Level and then by
 * row-major order (Requirement 14.6). Returns null when nothing is safe.
 */
export function findHintTarget(
  game: GameState,
  clicked: Tile,
  result: SolveResult,
): Tile | null {
  const safe: Tile[] = [];
  for (const [key, cls] of result.classification) {
    if (cls === 'Provably_Safe') safe.push(parseKey(key));
  }
  if (safe.length === 0) return null;

  let best: Tile | null = null;
  let bestDist = Infinity;
  let bestLevel = Infinity;

  for (const tile of safe) {
    const dist = chebyshev(tile, clicked);
    if (dist > bestDist) continue;
    const level = DEDUCTION_RANK[deductionLevelFor(game, tile)];
    if (
      best === null ||
      dist < bestDist ||
      (dist === bestDist && level < bestLevel) ||
      (dist === bestDist && level === bestLevel && rowMajorLess(tile, best))
    ) {
      best = tile;
      bestDist = dist;
      bestLevel = level;
    }
  }
  return best;
}

/** True when `a` comes before `b` in row-major order. */
function rowMajorLess(a: Tile, b: Tile): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

// ---------------------------------------------------------------------------
// Anchor_Numbers and Deduction_Level
// ---------------------------------------------------------------------------

/** A revealed Number together with its covered Neighbors (as keys). */
interface NumberClue {
  tile: Tile;
  number: number;
  coveredNeighbors: string[];
}

/** Collect every revealed Number that borders at least one covered Tile. */
function activeClues(game: GameState): NumberClue[] {
  const { board } = game;
  const { width, height } = board;
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
  const clues: NumberClue[] = [];
  for (const key of game.revealed) {
    if (mineSet.has(key)) continue;
    const [r, c] = parseKey(key);
    const covered: string[] = [];
    for (const nb of neighbors([r, c], width, height)) {
      const nk = tileKey(nb[0], nb[1]);
      if (!game.revealed.has(nk)) covered.push(nk);
    }
    if (covered.length === 0) continue;
    clues.push({
      tile: [r, c],
      number: numberAt([r, c], width, height, mineSet),
      coveredNeighbors: covered,
    });
  }
  return clues;
}

/**
 * Run the Solver on only a chosen subset of Numbers (a sub-Board_State), to
 * test whether those constraints alone prove `target` safe. When `withMineCount`
 * is true the global mine count is included; otherwise the mine count is set
 * high enough that it never constrains the sub-problem (so only the local
 * Numbers matter).
 */
function provesSafeWithClues(
  game: GameState,
  target: Tile,
  clues: NumberClue[],
  withMineCount: boolean,
): boolean {
  const { board } = game;
  const revealed = clues.map((c) => ({ tile: c.tile, number: c.number }));
  // Covered Tiles in this sub-problem: the union of the clues' covered
  // Neighbors. The Solver treats any in-bounds Tile not in `revealed` as
  // covered, so to isolate the sub-problem we need a mine count that does not
  // force anything on Tiles outside the clue neighborhoods. When the mine count
  // is not wanted, set it to the number of covered Tiles in the whole grid so
  // the global count is never binding.
  const coveredInGrid = board.width * board.height - revealed.length;
  const mineCount = withMineCount ? board.mines.length : coveredInGrid;

  const subState: BoardState = {
    width: board.width,
    height: board.height,
    mineCount,
    revealed,
  };
  const res = classify(subState);
  if (res.inconsistent || res.inexact) return false;
  return res.classification.get(tileKey(target[0], target[1])) === 'Provably_Safe';
}

/**
 * Find the Anchor_Numbers for a Hint_Target: the smallest set of revealed
 * Numbers whose constraints alone prove it safe. Tries one Number, then pairs,
 * then larger sets, running the Solver on only those constraints. When no set
 * of Numbers suffices without the total mine count, the mine count is added and
 * the search repeats (Requirement 14.7, Mine_Count deductions).
 *
 * Only clues whose covered-Neighbor set includes the target can prove it, so
 * the search is restricted to clues bordering the target plus, for the mine
 * count fallback, every active clue (since a mine-count argument can draw on
 * all remaining Numbers).
 */
export function findAnchors(
  game: GameState,
  target: Tile,
): { anchors: Tile[]; level: DeductionLevel; needsMineCount: boolean } {
  const clues = activeClues(game);
  const targetKey = tileKey(target[0], target[1]);

  // Clues that actually border the target — only these can locally constrain it.
  const bordering = clues.filter((c) => c.coveredNeighbors.includes(targetKey));

  // The candidate pool for larger deductions is the connected component of
  // Numbers reachable from the bordering clues through shared covered Tiles.
  // Numbers outside this component share no covered Tile with the target's
  // neighborhood, so they cannot contribute to proving the target safe. This
  // keeps the combination search small and relevant.
  const component = connectedClues(bordering, clues);

  // A single running budget bounds the whole search, so even a large component
  // can never blow up the combination enumeration.
  const budget = { remaining: ANCHOR_SEARCH_BUDGET };

  // Phase 1: local Numbers only, smallest subset first.
  const localResult = smallestProvingSubset(game, target, component, false, budget);
  if (localResult) {
    return {
      anchors: localResult.map((c) => c.tile),
      level: levelFromSize(localResult.length),
      needsMineCount: false,
    };
  }

  // Phase 2: add the mine count, over the same component of Numbers.
  const mineResult = smallestProvingSubset(game, target, component, true, budget);
  if (mineResult) {
    return {
      anchors: mineResult.map((c) => c.tile),
      level: 'Mine_Count',
      needsMineCount: true,
    };
  }

  // Fallback (budget exhausted, or a target only the full board proves): use
  // every bordering clue with the mine count, so the Nudge still points
  // somewhere sensible.
  return {
    anchors: bordering.map((c) => c.tile),
    level: 'Mine_Count',
    needsMineCount: true,
  };
}

/**
 * Cap on the number of Solver sub-calls across one Anchor_Numbers search. Each
 * subset tried counts as one. This keeps the combinatorial search bounded even
 * on large, densely connected Expert frontiers; when it is reached the search
 * falls back to the bordering clues.
 */
const ANCHOR_SEARCH_BUDGET = 400;

/** Largest Anchor_Numbers set the search considers (covers the catalog patterns). */
const MAX_ANCHOR_SIZE = 4;

/**
 * The connected component of Numbers containing `seeds`: every clue reachable
 * from a seed clue by hopping through shared covered Tiles. Returns at least the
 * seeds themselves.
 */
function connectedClues(seeds: NumberClue[], all: NumberClue[]): NumberClue[] {
  if (seeds.length === 0) return [];
  const inComponent = new Set<NumberClue>(seeds);
  const frontier = [...seeds];
  while (frontier.length > 0) {
    const cur = frontier.pop()!;
    const curCovered = new Set(cur.coveredNeighbors);
    for (const other of all) {
      if (inComponent.has(other)) continue;
      if (other.coveredNeighbors.some((k) => curCovered.has(k))) {
        inComponent.add(other);
        frontier.push(other);
      }
    }
  }
  return [...inComponent];
}

/**
 * Smallest subset of `clues` (by size, then combination order) whose
 * constraints prove `target` safe. Sizes are capped at `MAX_ANCHOR_SIZE` and the
 * whole search shares a Solver-call budget, so it stays cheap. Returns null when
 * nothing within the cap/budget proves the target.
 */
function smallestProvingSubset(
  game: GameState,
  target: Tile,
  clues: NumberClue[],
  withMineCount: boolean,
  budget: { remaining: number },
): NumberClue[] | null {
  const maxSize = Math.min(clues.length, MAX_ANCHOR_SIZE);
  for (let size = 1; size <= maxSize; size++) {
    const found = combinationsProve(game, target, clues, size, withMineCount, budget);
    if (found) return found;
    if (budget.remaining <= 0) return null;
  }
  return null;
}

/** Try every size-`k` combination of `clues`; return the first that proves safe. */
function combinationsProve(
  game: GameState,
  target: Tile,
  clues: NumberClue[],
  k: number,
  withMineCount: boolean,
  budget: { remaining: number },
): NumberClue[] | null {
  const n = clues.length;
  if (k > n) return null;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    if (budget.remaining-- <= 0) return null;
    const subset = idx.map((i) => clues[i]);
    if (provesSafeWithClues(game, target, subset, withMineCount)) return subset;
    // Advance the combination (lexicographic).
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return null;
}

/** Map an anchor-set size to the local Deduction_Level (no mine count). */
function levelFromSize(size: number): DeductionLevel {
  if (size <= 1) return 'Single_Clue';
  if (size === 2) return 'Pair_Clue';
  return 'Multi_Clue';
}

/** The Deduction_Level of a Provably_Safe Tile (used for Hint_Target ties). */
export function deductionLevelFor(game: GameState, target: Tile): DeductionLevel {
  return findAnchors(game, target).level;
}

// ---------------------------------------------------------------------------
// Hint_Region
// ---------------------------------------------------------------------------

/**
 * The Hint_Region: the smallest rectangle containing the Anchor_Numbers and all
 * their covered Neighbors (Requirement 14.7, Hint_Region definition).
 */
export function hintRegion(game: GameState, anchors: Tile[]): Region {
  const { board } = game;
  const { width, height } = board;
  let top = Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;

  const extend = (r: number, c: number): void => {
    if (r < top) top = r;
    if (r > bottom) bottom = r;
    if (c < left) left = c;
    if (c > right) right = c;
  };

  for (const [ar, ac] of anchors) {
    extend(ar, ac);
    for (const nb of neighbors([ar, ac], width, height)) {
      const nk = tileKey(nb[0], nb[1]);
      if (!game.revealed.has(nk)) extend(nb[0], nb[1]);
    }
  }

  // Defensive: with no anchors (should not happen) return a zero-area box at the
  // grid origin rather than Infinity bounds.
  if (!Number.isFinite(top)) return { top: 0, left: 0, bottom: 0, right: 0 };
  return { top, left, bottom, right };
}

// ---------------------------------------------------------------------------
// Nudge construction
// ---------------------------------------------------------------------------

/**
 * Build a stage-1 Nudge for an intercepted click, or null when nothing can be
 * proven safe (which only happens in an Inexact_State, handled separately).
 */
export function buildNudge(
  game: GameState,
  clicked: Tile,
  result: SolveResult,
): Nudge | null {
  const hintTarget = findHintTarget(game, clicked, result);
  if (!hintTarget) return null;
  const { anchors, level, needsMineCount } = findAnchors(game, hintTarget);
  return {
    stage: 1,
    hintTarget,
    anchors,
    region: hintRegion(game, anchors),
    deductionLevel: level,
    needsMineCount,
  };
}

// ---------------------------------------------------------------------------
// The practice action pipeline
// ---------------------------------------------------------------------------

/**
 * Apply a learner action in Practice_Mode and return the next PracticeState.
 *
 * Rules (Requirement 14):
 *  - Flag_Toggle applies without any Solver check (14.9), and clears no Nudge.
 *  - A Reveal_Action is checked by the Solver first (14.2, 14.3):
 *      * all Target_Tiles Provably_Safe  -> apply, clear the Nudge.
 *      * some Target_Tile not safe        -> intercept: leave the Board_State
 *        unchanged, bump the intercept count, and show a Nudge. If a Nudge is
 *        already on screen for the same Hint_Target, advance it to stage 2
 *        (14.4, 14.5).
 *  - An Inexact_State (14.10): apply a Reveal_Action whose targets are all
 *    non-mine Tiles, and block one that would reveal a mine with a message and
 *    no Nudge.
 *
 * `stepBudget` is forwarded to the Solver so tests can force an Inexact_State.
 */
export function applyPracticeAction(
  state: PracticeState,
  action: Action,
  stepBudget?: number,
): PracticeResult {
  const { game } = state;

  // Game already finished: nothing changes.
  if (game.status === 'won' || game.status === 'lost') {
    return { state, message: null };
  }

  // Flags apply unconditionally and leave any Nudge in place.
  if (action.type === 'Flag_Toggle') {
    const nextGame = applyAction(game, action, 0);
    return {
      state: { ...state, game: nextGame },
      message: null,
    };
  }

  // Non-reveal, non-flag actions (none exist today) pass through unchanged.
  if (!isRevealAction(action)) {
    return { state, message: null };
  }

  // Before the Start_Tile is revealed, defer entirely to the engine. The
  // Start_Tile reveal is guaranteed safe and needs no Solver check; every other
  // action is ignored by the engine (Requirement 1.2). Applying here keeps the
  // Nudge untouched and never intercepts the opening move.
  if (!game.startRevealed) {
    const nextGame = applyAction(game, action, 0);
    return { state: { ...state, game: nextGame }, message: null };
  }

  const targets = revealTargets(game, action);
  // A chord that would change nothing (unsatisfied / nothing to reveal) is a
  // Wasted_Click: apply it so the engine logs it, and clear nothing.
  if (targets.length === 0) {
    const nextGame = applyAction(game, action, 0);
    return { state: { ...state, game: nextGame }, message: null };
  }

  const result = classifyGame(game, stepBudget);

  // Inexact_State handling (14.10): the Solver could not finish, so fall back to
  // the ground truth. Apply when the targets are all non-mine; block with a
  // message (no Nudge) when any target is a mine.
  if (result.inexact) {
    const mineSet = new Set(game.board.mines.map(([r, c]) => tileKey(r, c)));
    const hitsMine = targets.some(([r, c]) => mineSet.has(tileKey(r, c)));
    if (hitsMine) {
      return { state, message: INEXACT_BLOCKED_MESSAGE };
    }
    const nextGame = applyAction(game, action, 0);
    return {
      state: { ...state, game: nextGame, nudge: null },
      message: null,
    };
  }

  // Normal path: apply only when every Target_Tile is Provably_Safe.
  if (targetsAllSafe(targets, result)) {
    const nextGame = applyAction(game, action, 0);
    return {
      state: { ...state, game: nextGame, nudge: null },
      message: null,
    };
  }

  // Intercept: leave the Board_State unchanged and produce/advance the Nudge.
  const clicked = action.tile;
  const existing = state.nudge;
  let nudge: Nudge | null;
  let stage2Delta = 0;

  if (existing && sameTile(existing.hintTarget, pickHintTarget(game, clicked, result, existing))) {
    // Another intercepted action while a Nudge is up: advance to stage 2 for the
    // same Hint_Target (14.4, 14.5). Stage 2 is the most detailed help.
    if (existing.stage === 1) {
      nudge = { ...existing, stage: 2 };
      stage2Delta = 1;
    } else {
      nudge = existing; // already at stage 2: stays there.
    }
  } else {
    nudge = buildNudge(game, clicked, result);
  }

  return {
    state: {
      ...state,
      // Board_State is explicitly unchanged here (guardrail 14.8).
      nudge,
      interceptedCount: state.interceptedCount + 1,
      stage2Count: state.stage2Count + stage2Delta,
    },
    message: NOT_PROVABLE_MESSAGE,
  };
}

/**
 * Advance the current Nudge to stage 2 for the same Hint_Target in response to a
 * "More Help" control (Requirement 14.4). Returns the state unchanged when no
 * Nudge is shown or it is already at stage 2.
 */
export function requestMoreHelp(state: PracticeState): PracticeState {
  const { nudge } = state;
  if (!nudge || nudge.stage === 2) return state;
  return {
    ...state,
    nudge: { ...nudge, stage: 2 },
    stage2Count: state.stage2Count + 1,
  };
}

/**
 * Decide which Hint_Target a repeat intercept should use. When a Nudge is
 * already shown, the same Hint_Target is kept (its stage advances); otherwise
 * the nearest Provably_Safe Tile to the newly clicked Tile is chosen. This
 * helper keeps `applyPracticeAction` readable.
 */
function pickHintTarget(
  game: GameState,
  clicked: Tile,
  result: SolveResult,
  existing: Nudge | null,
): Tile {
  if (existing) return existing.hintTarget;
  return findHintTarget(game, clicked, result) ?? clicked;
}

/** True when two Tiles are the same cell. */
function sameTile(a: Tile, b: Tile): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Parse a `"row,col"` key into a Tile. */
function parseKey(key: string): Tile {
  const comma = key.indexOf(',');
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

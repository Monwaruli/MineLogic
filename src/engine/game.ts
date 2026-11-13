/**
 * The Board_Engine: applies player actions to a Board and produces the next
 * Board_State. Pure, with no React or DOM imports, so it runs in tests, Web
 * Workers, and tools.
 *
 * Every apply function takes a Board_State and an action and returns a *new*
 * Board_State; the input is never mutated.
 *
 * Rules implemented (Requirement 1):
 *  - Before the Start_Tile is revealed, every action except the Start_Tile's
 *    Reveal_Click is ignored and left out of the Move_Log (full boards only).
 *  - Revealing the Start_Tile zeroes the clock and reveals its Opening.
 *  - Reveal_Click reveals a covered, unflagged, non-mine Tile and cascades
 *    through zero-Number Tiles (8-connected, stopped by flags).
 *  - Flag_Toggle adds or removes a flag on a covered Tile.
 *  - Chord_Click on a satisfied Number reveals its covered, unflagged Neighbors;
 *    on an unsatisfied Number it changes nothing and is logged as a Wasted_Click.
 *  - Revealing a mine loses; revealing every non-mine Tile wins.
 *  - The mine counter is the mine count minus the flags placed.
 *  - Each applied action is appended to the Move_Log with its type, Tile, and
 *    the elapsed milliseconds since the Start_Tile was revealed.
 *
 * See the Design Notes in tasks.md and Requirement 1.
 */

import {
  neighbors,
  numberAt,
  tileKey,
  type Board,
  type Tile,
} from './board';

/** The kinds of player action the engine applies. */
export type ActionType = 'Reveal_Click' | 'Flag_Toggle' | 'Chord_Click';

/** A player action targeting a Tile. */
export interface Action {
  type: ActionType;
  tile: Tile;
}

/** One entry in the Move_Log. */
export interface MoveLogEntry {
  type: ActionType;
  tile: Tile;
  /** Milliseconds since the Start_Tile was revealed; 0 for the start reveal. */
  elapsedMs: number;
  /** True for a Chord_Click that changed nothing. */
  wastedClick: boolean;
}

/** Game outcome. */
export type Status = 'pending_start' | 'playing' | 'won' | 'lost';

/**
 * The mutable playing state produced from a Board.
 *
 * `revealed` and `flags` hold `"row,col"` keys. `startRevealed` is false until
 * the Start_Tile is revealed on a full board (always true from the start on a
 * board that ships with an initial revealed set). `startRevealedAt` is the
 * timestamp used to compute elapsed milliseconds.
 */
export interface GameState {
  board: Board;
  revealed: Set<string>;
  flags: Set<string>;
  status: Status;
  startRevealed: boolean;
  /** Epoch ms when the Start_Tile was revealed, or null before then. */
  startRevealedAt: number | null;
  moveLog: MoveLogEntry[];
}

/** The mine positions of a Board as a `"row,col"` key set. */
function mineSetOf(board: Board): Set<string> {
  return new Set(board.mines.map(([r, c]) => tileKey(r, c)));
}

/**
 * Create a fresh GameState for a Board.
 *
 * A full Board (with a `startTile`) starts in `pending_start`: nothing is
 * revealed and only the Start_Tile's Reveal_Click is honored. A Board that
 * ships with `initialRevealed` starts in `playing` with those Tiles revealed
 * and the clock already running from `now`.
 */
export function createGame(board: Board, now: number = 0): GameState {
  const revealed = new Set<string>();
  if (board.initialRevealed && board.initialRevealed.length > 0) {
    for (const [r, c] of board.initialRevealed) revealed.add(tileKey(r, c));
    return {
      board,
      revealed,
      flags: new Set<string>(),
      status: 'playing',
      startRevealed: true,
      startRevealedAt: now,
      moveLog: [],
    };
  }
  return {
    board,
    revealed,
    flags: new Set<string>(),
    status: 'pending_start',
    startRevealed: false,
    startRevealedAt: null,
    moveLog: [],
  };
}

/** The mine counter: mine count minus the number of flags placed. */
export function mineCounter(state: GameState): number {
  return state.board.mines.length - state.flags.size;
}

/** Shallow-clone the mutable parts of a GameState so callers stay pure. */
function cloneState(state: GameState): GameState {
  return {
    board: state.board,
    revealed: new Set(state.revealed),
    flags: new Set(state.flags),
    status: state.status,
    startRevealed: state.startRevealed,
    startRevealedAt: state.startRevealedAt,
    moveLog: state.moveLog.slice(),
  };
}

/**
 * Reveal a Tile and cascade through its Opening.
 *
 * Mutates `revealed` in place (on an already-cloned state). Stops the cascade
 * at flagged Tiles and never reveals a flagged Tile. Returns true if it
 * revealed a mine (a loss).
 */
function revealAndCascade(
  next: GameState,
  start: Tile,
  mineSet: Set<string>,
): boolean {
  const { width, height } = next.board;
  const startKey = tileKey(start[0], start[1]);

  // A direct reveal of a mine is a loss.
  if (mineSet.has(startKey)) {
    next.revealed.add(startKey);
    return true;
  }

  const stack: Tile[] = [start];
  while (stack.length > 0) {
    const tile = stack.pop()!;
    const key = tileKey(tile[0], tile[1]);
    if (next.revealed.has(key)) continue;
    if (next.flags.has(key)) continue; // flags stop the cascade
    if (mineSet.has(key)) continue; // never auto-reveal a mine during cascade
    next.revealed.add(key);
    if (numberAt(tile, width, height, mineSet) === 0) {
      for (const nb of neighbors(tile, width, height)) stack.push(nb);
    }
  }
  return false;
}

/** True when every non-mine Tile is revealed. */
function isWin(state: GameState, mineSet: Set<string>): boolean {
  const { width, height } = state.board;
  const total = width * height;
  return state.revealed.size === total - mineSet.size;
}

/**
 * Finish a loss: reveal every mine and record the loss. (Flags not on mines are
 * a display concern for the Board_View; the engine simply marks the loss and
 * exposes the mines via `revealed` so the view can render them.)
 */
function finalizeLoss(next: GameState, mineSet: Set<string>): void {
  // Show every mine. A mine the player already flagged stays flagged (a correct
  // flag), so it is not added to `revealed`; the Board_View renders flagged
  // mines from the flag set. This keeps the flag and revealed sets disjoint.
  for (const key of mineSet) {
    if (!next.flags.has(key)) next.revealed.add(key);
  }
  next.status = 'lost';
}

/** Finish a win: flag every mine and record the win. */
function finalizeWin(next: GameState, mineSet: Set<string>): void {
  for (const key of mineSet) next.flags.add(key);
  next.status = 'won';
}

/** Append a Move_Log entry using the elapsed time since the Start_Tile reveal. */
function logMove(next: GameState, action: Action, now: number, wasted: boolean): void {
  const elapsedMs = next.startRevealedAt === null ? 0 : Math.max(0, now - next.startRevealedAt);
  next.moveLog.push({
    type: action.type,
    tile: action.tile,
    elapsedMs,
    wastedClick: wasted,
  });
}

/**
 * Apply a player action to a GameState and return the next GameState.
 *
 * `now` is the current epoch-ms timestamp, used for the Move_Log and for
 * starting the clock on the Start_Tile reveal. The input state is never
 * mutated.
 */
export function applyAction(state: GameState, action: Action, now: number = 0): GameState {
  // No actions after the game ends.
  if (state.status === 'won' || state.status === 'lost') return state;

  const mineSet = mineSetOf(state.board);
  const { width, height } = state.board;
  const [ar, ac] = action.tile;

  // Out-of-bounds actions are ignored.
  if (ar < 0 || ar >= height || ac < 0 || ac >= width) return state;

  const key = tileKey(ar, ac);

  // Before the Start_Tile is revealed, ignore everything except the
  // Start_Tile's Reveal_Click, and keep it out of the Move_Log.
  if (!state.startRevealed) {
    const start = state.board.startTile;
    const isStartReveal =
      action.type === 'Reveal_Click' &&
      !!start &&
      start[0] === ar &&
      start[1] === ac;
    if (!isStartReveal) return state;

    const next = cloneState(state);
    next.startRevealed = true;
    next.startRevealedAt = now;
    next.status = 'playing';
    revealAndCascade(next, action.tile, mineSet); // start cannot be a mine
    logMove(next, action, now, false);
    if (isWin(next, mineSet)) finalizeWin(next, mineSet);
    return next;
  }

  // ---- Flag_Toggle ----
  if (action.type === 'Flag_Toggle') {
    if (state.revealed.has(key)) return state; // only covered Tiles take flags
    const next = cloneState(state);
    if (next.flags.has(key)) next.flags.delete(key);
    else next.flags.add(key);
    logMove(next, action, now, false);
    return next;
  }

  // ---- Reveal_Click ----
  if (action.type === 'Reveal_Click') {
    // A covered, unflagged Tile only. Flagged or already-revealed: ignore.
    if (state.revealed.has(key) || state.flags.has(key)) return state;
    const next = cloneState(state);
    const hitMine = revealAndCascade(next, action.tile, mineSet);
    logMove(next, action, now, false);
    if (hitMine) finalizeLoss(next, mineSet);
    else if (isWin(next, mineSet)) finalizeWin(next, mineSet);
    return next;
  }

  // ---- Chord_Click ----
  if (action.type === 'Chord_Click') {
    // Must target a revealed Number.
    if (!state.revealed.has(key)) return state;
    const number = numberAt(action.tile, width, height, mineSet);

    let flaggedNeighbors = 0;
    const toReveal: Tile[] = [];
    for (const nb of neighbors(action.tile, width, height)) {
      const nk = tileKey(nb[0], nb[1]);
      if (state.flags.has(nk)) flaggedNeighbors++;
      else if (!state.revealed.has(nk)) toReveal.push(nb);
    }

    // Unsatisfied Number, or nothing to reveal: Wasted_Click, state unchanged.
    if (flaggedNeighbors !== number || toReveal.length === 0) {
      const next = cloneState(state);
      logMove(next, action, now, true);
      return next;
    }

    const next = cloneState(state);
    let hitMine = false;
    for (const nb of toReveal) {
      if (revealAndCascade(next, nb, mineSet)) hitMine = true;
    }
    logMove(next, action, now, false);
    if (hitMine) finalizeLoss(next, mineSet);
    else if (isWin(next, mineSet)) finalizeWin(next, mineSet);
    return next;
  }

  return state;
}

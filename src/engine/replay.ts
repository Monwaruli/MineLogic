/**
 * The Replay_Viewer's engine (task 6, Requirement 16).
 *
 * Pure engine logic, no React or DOM imports, so the stepping, labeling, and
 * loss analysis are testable without a UI. A thin React component can sit on
 * top of this and render the frames; all the logic lives here.
 *
 * A replay is built from a Board and its Move_Log. It precomputes one frame per
 * action (plus an initial frame before any action), each carrying the
 * Board_State at that point and a label for the action that produced it
 * (Logical_Move, Guess, Flag_Toggle, or Wasted_Click, per Requirement 16.3).
 * The caller steps forward and back or jumps to any action by index
 * (Requirement 16.2).
 *
 * After a loss the replay also exposes (Requirement 16.4-16.6):
 *  - the Board_State immediately before the losing action, with every
 *    Provably_Safe Tile highlighted and labeled with its Pattern_Type;
 *  - the list of unresolved Pattern_Instances with Pattern_Type and appearance
 *    time;
 *  - for a selected unresolved instance, the Board_State at the instance's
 *    appearance time with its Anchor_Numbers and Tiles highlighted.
 *
 * See Requirement 16 and the Design Notes in tasks.md.
 */

import { tileKey, type Board, type Tile } from './board';
import {
  applyAction,
  createGame,
  type Action,
  type GameState,
} from './game';
import { classify } from './solver';
import { boardStateOf } from './practice';
import {
  attributeSafeTiles,
  detectPatternInstances,
  type PatternInstance,
  type PatternType,
} from './patterns';
import type { MoveLog } from './moveLog';

/** How the Replay_Viewer labels one action (Requirement 16.3). */
export type ActionLabel = 'Logical_Move' | 'Guess' | 'Flag_Toggle' | 'Wasted_Click';

/** One step of the replay: the state after an action and that action's label. */
export interface ReplayFrame {
  /** Index into the Move_Log entries, or -1 for the initial pre-game frame. */
  index: number;
  /** The action that produced this frame, or null for the initial frame. */
  action: Action | null;
  /** The label of that action, or null for the initial frame. */
  label: ActionLabel | null;
  /** The Board_State after applying the action (the initial state for index -1). */
  state: GameState;
}

/** A Provably_Safe Tile highlighted in the loss view, with its Pattern_Type. */
export interface SafeHighlight {
  tile: Tile;
  patternType: PatternType;
}

/**
 * The loss analysis shown when the replay of a lost game opens
 * (Requirement 16.4, 16.5). Null for games that were not lost.
 */
export interface LossView {
  /** The Board_State immediately before the losing action. */
  state: GameState;
  /** Every Provably_Safe Tile in that state, labeled with its Pattern_Type. */
  safeTiles: SafeHighlight[];
  /** Unresolved Pattern_Instances, with Pattern_Type and appearance time. */
  unresolved: PatternInstance[];
}

/**
 * The view of one Pattern_Instance at its appearance time (Requirement 16.6):
 * the Board_State then, plus the instance's Anchor_Numbers and Tiles to
 * highlight.
 */
export interface InstanceView {
  state: GameState;
  anchors: Tile[];
  tiles: Tile[];
}

/** A fully built replay, ready to step through. */
export interface Replay {
  board: Board;
  log: MoveLog;
  /** One frame per action plus the initial frame at index 0 (log index -1). */
  frames: ReplayFrame[];
  /** The loss analysis, or null when the game was not lost. */
  loss: LossView | null;
  /** Every detected Pattern_Instance, in appearance order. */
  instances: PatternInstance[];
}

/**
 * The Target_Tiles of a Reveal_Action in a Board_State: the clicked Tile for a
 * Reveal_Click, and the covered, unflagged Neighbors for a satisfied
 * Chord_Click. Empty when the action reveals nothing.
 */
function revealTargets(state: GameState, action: Action): Tile[] {
  const { board } = state;
  const { width, height } = board;
  if (action.type === 'Reveal_Click') {
    const key = tileKey(action.tile[0], action.tile[1]);
    if (state.revealed.has(key) || state.flags.has(key)) return [];
    return [action.tile];
  }
  if (action.type === 'Chord_Click') {
    const key = tileKey(action.tile[0], action.tile[1]);
    if (!state.revealed.has(key)) return [];
    const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
    // numberAt via a local recompute to avoid importing numberAt redundantly:
    // count mines among neighbors.
    let number = 0;
    let flagged = 0;
    const covered: Tile[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = action.tile[0] + dr;
        const c = action.tile[1] + dc;
        if (r < 0 || r >= height || c < 0 || c >= width) continue;
        const nk = tileKey(r, c);
        if (mineSet.has(nk)) number++;
        if (state.flags.has(nk)) flagged++;
        else if (!state.revealed.has(nk)) covered.push([r, c]);
      }
    }
    if (flagged !== number) return [];
    return covered;
  }
  return [];
}

/**
 * Label one action given the Board_State immediately before it was applied and
 * the resulting Move_Log entry (for the Wasted_Click mark). Follows the
 * Metrics_Engine's Logical_Move / Guess rule for Reveal_Actions
 * (Requirement 16.3).
 */
function labelAction(
  before: GameState,
  action: Action,
  wasted: boolean,
  isStartReveal: boolean,
): ActionLabel {
  if (action.type === 'Flag_Toggle') return 'Flag_Toggle';
  if (action.type === 'Chord_Click' && wasted) return 'Wasted_Click';

  // The Start_Tile reveal is a forced opening move, not a deduction. Label it a
  // Logical_Move so the replay never calls the guaranteed-safe opening a Guess.
  if (isStartReveal) return 'Logical_Move';

  const targets = revealTargets(before, action);
  if (targets.length === 0) {
    // A Reveal_Click on an already-revealed/flagged Tile or a chord that reveals
    // nothing: treat a non-wasted chord with no targets as a Wasted_Click, and
    // anything else as a Guess fallback (it changed nothing meaningful).
    return action.type === 'Chord_Click' ? 'Wasted_Click' : 'Guess';
  }

  const result = classify(boardStateOf(before));
  if (result.inexact) return 'Guess'; // cannot prove; treat as a Guess for labeling
  const allSafe = targets.every(
    (t) => result.classification.get(tileKey(t[0], t[1])) === 'Provably_Safe',
  );
  return allSafe ? 'Logical_Move' : 'Guess';
}

/**
 * Build a Replay from a Board and its Move_Log.
 *
 * Replaying mirrors the Board_Engine: each frame holds the state after one
 * action. The loss view, when the game ended in a loss, captures the state just
 * before the losing action and analyzes the missed safe Tiles and unresolved
 * Pattern_Instances.
 */
export function buildReplay(board: Board, log: MoveLog): Replay {
  const frames: ReplayFrame[] = [];
  let state = createGame(board, 0);

  // Initial frame, before any action.
  frames.push({ index: -1, action: null, label: null, state });

  // The state immediately before the losing action, captured during the walk.
  let preLossState: GameState | null = null;

  log.entries.forEach((entry, i) => {
    const action: Action = { type: entry.type, tile: entry.tile };
    const before = state;
    const isStartReveal = !before.startRevealed;
    const next = applyAction(before, action, entry.elapsedMs);

    // A loss is detected when the state transitions to 'lost'. The frame just
    // before this action is the Board_State to analyze (Requirement 16.4).
    if (before.status === 'playing' && next.status === 'lost') {
      preLossState = before;
    }
    // Also handle a loss straight off the opening (cannot happen on a real
    // Start_Tile, but stay safe): if the very first move loses, the pre-loss
    // state is the initial state.
    if (before.status === 'pending_start' && next.status === 'lost') {
      preLossState = before;
    }

    const label = labelAction(before, action, entry.wastedClick, isStartReveal);
    frames.push({ index: i, action, label, state: next });
    state = next;
  });

  const instances = detectPatternInstances(board, log);

  let loss: LossView | null = null;
  if (state.status === 'lost' && preLossState) {
    const attr = attributeSafeTiles(preLossState);
    const safeTiles: SafeHighlight[] = [];
    for (const a of attr.values()) {
      safeTiles.push({ tile: a.tile, patternType: a.patternType });
    }
    safeTiles.sort((x, y) => x.tile[0] - y.tile[0] || x.tile[1] - y.tile[1]);

    const unresolved = instances.filter((inst) => inst.status === 'unresolved');
    loss = { state: preLossState, safeTiles, unresolved };
  }

  return { board, log, frames, loss, instances };
}

/**
 * The frame at a given log index, clamped to the valid range. Index -1 is the
 * initial frame; 0..entries-1 are the post-action frames. `stepForward` and
 * `stepBack` are expressed in terms of this.
 */
export function frameAt(replay: Replay, index: number): ReplayFrame {
  // frames[0] is index -1, frames[k+1] is log index k.
  const clamped = Math.max(-1, Math.min(index, replay.log.entries.length - 1));
  return replay.frames[clamped + 1];
}

/** The next frame after `index`, or the last frame when already at the end. */
export function stepForward(replay: Replay, index: number): ReplayFrame {
  return frameAt(replay, index + 1);
}

/** The previous frame before `index`, or the initial frame when at the start. */
export function stepBack(replay: Replay, index: number): ReplayFrame {
  return frameAt(replay, index - 1);
}

/**
 * The view of a selected unresolved (or any) Pattern_Instance at its appearance
 * time (Requirement 16.6): the Board_State reached right after the action whose
 * timestamp equals the instance's appearance time, with the instance's
 * Anchor_Numbers and Tiles to highlight.
 *
 * The appearance time is an elapsed-ms value equal to some entry's `elapsedMs`;
 * the instance appeared *after* that action, so the state to show is the frame
 * for that action. When several actions share a timestamp, the latest one at or
 * before the appearance time is used.
 */
export function instanceView(replay: Replay, instance: PatternInstance): InstanceView {
  // Find the last frame whose action elapsedMs <= appearanceMs; that frame's
  // state is the Board_State at the appearance time.
  let chosen: ReplayFrame = replay.frames[0];
  for (const frame of replay.frames) {
    if (frame.index < 0) continue;
    const entry = replay.log.entries[frame.index];
    if (entry.elapsedMs <= instance.appearanceMs) chosen = frame;
    else break;
  }
  return { state: chosen.state, anchors: instance.anchors, tiles: instance.tiles };
}

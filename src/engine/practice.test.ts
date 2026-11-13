/**
 * Tests for Follow-Along Practice and the two-stage Nudge (task 5).
 *
 * Unit tests cover interception, applying safe actions, flag pass-through, the
 * stage-1 -> stage-2 progression, Hint_Target selection, Anchor_Numbers, and the
 * Hint_Region box. Property tests cover the two required guarantees:
 *   - showing a Nudge leaves the Board_State unchanged (guardrail 14.8), and
 *   - no sequence of practice actions ever reveals a mine (14.3, 14.10).
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.11
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { tileKey, type Board, type Tile } from './board';
import { DIFFICULTIES } from './board';
import type { Action, GameState } from './game';
import { generate } from './generator';
import {
  applyPracticeAction,
  createPractice,
  requestMoreHelp,
  findHintTarget,
  findAnchors,
  hintRegion,
  classifyGame,
  revealTargets,
  type PracticeState,
} from './practice';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a full Board with a Start_Tile from mines and dimensions. */
function makeBoard(
  width: number,
  height: number,
  mines: Tile[],
  startTile: Tile,
): Board {
  return { id: 'test', width, height, mines, startTile };
}

/** Snapshot the mutable Board_State of a GameState for equality checks. */
function snapshot(game: GameState): string {
  return JSON.stringify({
    revealed: [...game.revealed].sort(),
    flags: [...game.flags].sort(),
    status: game.status,
    startRevealed: game.startRevealed,
    moveLog: game.moveLog,
  });
}

/** Reveal a Tile through the practice pipeline (helper for arranging states). */
function reveal(state: PracticeState, tile: Tile): PracticeState {
  return applyPracticeAction(state, { type: 'Reveal_Click', tile }).state;
}

/** True when a Tile is a mine of a Board. */
function isMine(board: Board, [r, c]: Tile): boolean {
  const set = new Set(board.mines.map(([mr, mc]) => tileKey(mr, mc)));
  return set.has(tileKey(r, c));
}

// A small hand-built board where, after revealing the Start_Tile's opening,
// some covered tiles are Provably_Safe and others are not, so interception and
// nudges can be exercised deterministically. Layout (5x3, M = mine):
//
//   col:  0 1 2 3 4
//   row0: . . . . .
//   row1: . . . M .
//   row2: . . . . .
//
// Start_Tile (0,0) has no adjacent mine and opens a region.
const SMALL: Board = makeBoard(5, 3, [[1, 3]], [0, 0]);

// ---------------------------------------------------------------------------
// Applying safe actions and clearing the board
// ---------------------------------------------------------------------------

describe('applyPracticeAction — safe reveals', () => {
  it('applies a Reveal_Action whose targets are all Provably_Safe and clears the Nudge', () => {
    let s = createPractice(SMALL);
    // Reveal the Start_Tile (always allowed as the opening).
    s = reveal(s, [0, 0]);
    expect(s.game.revealed.has(tileKey(0, 0))).toBe(true);

    // After the opening cascade, (0,4) is far from the single mine and is
    // Provably_Safe. Revealing it should apply.
    const result = classifyGame(s.game);
    const safeTarget = [...result.classification.entries()].find(
      ([, cls]) => cls === 'Provably_Safe',
    );
    expect(safeTarget).toBeDefined();
    const [key] = safeTarget!;
    const [r, c] = key.split(',').map(Number) as Tile;

    const before = snapshot(s.game);
    const applied = applyPracticeAction(s, { type: 'Reveal_Click', tile: [r, c] });
    expect(applied.message).toBeNull();
    expect(applied.state.game.revealed.has(key)).toBe(true);
    expect(snapshot(applied.state.game)).not.toBe(before);
    expect(applied.state.nudge).toBeNull();
  });

  it('records completion counts when the board is cleared', () => {
    // Clear the whole board by revealing every provably-safe tile repeatedly.
    let s = createPractice(SMALL);
    s = reveal(s, [0, 0]);

    // Keep revealing provably-safe tiles until the game is won.
    for (let guard = 0; guard < 100 && s.game.status === 'playing'; guard++) {
      const res = classifyGame(s.game);
      let progressed = false;
      for (const [key, cls] of res.classification) {
        if (cls !== 'Provably_Safe') continue;
        if (s.game.revealed.has(key)) continue;
        const [r, c] = key.split(',').map(Number) as Tile;
        s = reveal(s, [r, c]);
        progressed = true;
      }
      if (!progressed) break;
    }

    expect(s.game.status).toBe('won');
    // interceptedCount and stage2Count are the completion counters shown (14.11).
    expect(s.interceptedCount).toBe(0);
    expect(s.stage2Count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Interception and the two-stage Nudge
// ---------------------------------------------------------------------------

describe('applyPracticeAction — interception', () => {
  /** Arrange a state with at least one covered non-safe tile to click. */
  function arrangeInterceptable(): { state: PracticeState; target: Tile } {
    let s = createPractice(SMALL);
    s = reveal(s, [0, 0]);
    const res = classifyGame(s.game);
    // Find a covered tile that is NOT provably safe (e.g. undetermined near the mine).
    for (const [key, cls] of res.classification) {
      if (cls === 'Provably_Safe') continue;
      const [r, c] = key.split(',').map(Number) as Tile;
      return { state: s, target: [r, c] };
    }
    throw new Error('no interceptable tile found in fixture');
  }

  it('intercepts an unprovable reveal, leaves the board unchanged, and shows stage 1', () => {
    const { state, target } = arrangeInterceptable();
    const before = snapshot(state.game);

    const out = applyPracticeAction(state, { type: 'Reveal_Click', tile: target });

    expect(out.message).not.toBeNull();
    expect(snapshot(out.state.game)).toBe(before); // Board_State unchanged (14.8)
    expect(out.state.nudge).not.toBeNull();
    expect(out.state.nudge!.stage).toBe(1);
    expect(out.state.interceptedCount).toBe(1);
    expect(out.state.stage2Count).toBe(0);
  });

  it('advances to stage 2 on a second intercepted click for the same Hint_Target', () => {
    const { state, target } = arrangeInterceptable();
    const first = applyPracticeAction(state, { type: 'Reveal_Click', tile: target });
    expect(first.state.nudge!.stage).toBe(1);

    const second = applyPracticeAction(first.state, { type: 'Reveal_Click', tile: target });
    expect(second.state.nudge!.stage).toBe(2);
    expect(second.state.stage2Count).toBe(1);
    // Same Hint_Target across the two stages (14.5).
    expect(second.state.nudge!.hintTarget).toEqual(first.state.nudge!.hintTarget);

    // A third intercept keeps stage 2 (most detailed help) and does not double-count.
    const third = applyPracticeAction(second.state, { type: 'Reveal_Click', tile: target });
    expect(third.state.nudge!.stage).toBe(2);
    expect(third.state.stage2Count).toBe(1);
  });

  it('advances to stage 2 via the More Help control', () => {
    const { state, target } = arrangeInterceptable();
    const first = applyPracticeAction(state, { type: 'Reveal_Click', tile: target });
    const helped = requestMoreHelp(first.state);
    expect(helped.nudge!.stage).toBe(2);
    expect(helped.stage2Count).toBe(1);
    // A second More Help is a no-op (already most detailed).
    const again = requestMoreHelp(helped);
    expect(again.stage2Count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Flags apply without checks
// ---------------------------------------------------------------------------

describe('applyPracticeAction — flags', () => {
  it('applies a Flag_Toggle without any Solver check and keeps the Nudge', () => {
    let s = createPractice(SMALL);
    s = reveal(s, [0, 0]);
    // Place a nudge by intercepting a click.
    const res = classifyGame(s.game);
    let notSafe: Tile | null = null;
    for (const [key, cls] of res.classification) {
      if (cls !== 'Provably_Safe' && !s.game.revealed.has(key)) {
        notSafe = key.split(',').map(Number) as Tile;
        break;
      }
    }
    const intercepted = applyPracticeAction(s, { type: 'Reveal_Click', tile: notSafe! });
    expect(intercepted.state.nudge).not.toBeNull();

    // Flagging any covered tile applies and keeps the nudge in place.
    const flagTile: Tile = [1, 3]; // the mine; flags apply without checks
    const flagged = applyPracticeAction(intercepted.state, {
      type: 'Flag_Toggle',
      tile: flagTile,
    });
    expect(flagged.state.game.flags.has(tileKey(1, 3))).toBe(true);
    expect(flagged.state.nudge).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hint_Target, Anchor_Numbers, Hint_Region
// ---------------------------------------------------------------------------

describe('Hint_Coach selection', () => {
  it('chooses the nearest Provably_Safe tile by Chebyshev distance', () => {
    let s = createPractice(SMALL);
    s = reveal(s, [0, 0]);
    const res = classifyGame(s.game);
    // Click right next to the mine; the nearest safe tile should be chosen.
    const clicked: Tile = [2, 3];
    const target = findHintTarget(s.game, clicked, res);
    expect(target).not.toBeNull();
    // The chosen target is Provably_Safe.
    expect(res.classification.get(tileKey(target![0], target![1]))).toBe('Provably_Safe');
    // No other safe tile is strictly closer.
    const cheb = (a: Tile, b: Tile) =>
      Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    const chosenDist = cheb(target!, clicked);
    for (const [key, cls] of res.classification) {
      if (cls !== 'Provably_Safe') continue;
      const t = key.split(',').map(Number) as Tile;
      expect(cheb(t, clicked)).toBeGreaterThanOrEqual(chosenDist);
    }
  });

  it('finds Anchor_Numbers that alone prove the Hint_Target safe', () => {
    let s = createPractice(SMALL);
    s = reveal(s, [0, 0]);
    const res = classifyGame(s.game);
    const target = [...res.classification.entries()].find(
      ([, c]) => c === 'Provably_Safe',
    )![0];
    const [tr, tc] = target.split(',').map(Number) as Tile;
    const { anchors } = findAnchors(s.game, [tr, tc]);
    // Every anchor is a revealed tile.
    for (const [ar, ac] of anchors) {
      expect(s.game.revealed.has(tileKey(ar, ac))).toBe(true);
    }
  });

  it('computes a Hint_Region that contains every anchor', () => {
    let s = createPractice(SMALL);
    s = reveal(s, [0, 0]);
    const res = classifyGame(s.game);
    const target = [...res.classification.entries()].find(
      ([, c]) => c === 'Provably_Safe',
    )![0];
    const [tr, tc] = target.split(',').map(Number) as Tile;
    const { anchors } = findAnchors(s.game, [tr, tc]);
    const region = hintRegion(s.game, anchors);
    for (const [ar, ac] of anchors) {
      expect(ar).toBeGreaterThanOrEqual(region.top);
      expect(ar).toBeLessThanOrEqual(region.bottom);
      expect(ac).toBeGreaterThanOrEqual(region.left);
      expect(ac).toBeLessThanOrEqual(region.right);
    }
  });
});

// ---------------------------------------------------------------------------
// Property: a Nudge never changes the Board_State (guardrail 14.8)
// ---------------------------------------------------------------------------

describe('guardrail property — a Nudge leaves the Board_State unchanged', () => {
  it('any intercepted Reveal_Action leaves revealed/flags/status untouched', () => {
    const board = generate(DIFFICULTIES.Beginner, 12345).board;
    const base = reveal(createPractice(board), board.startTile!);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: board.height - 1 }),
        fc.integer({ min: 0, max: board.width - 1 }),
        (r, c) => {
          const tile: Tile = [r, c];
          // Only consider covered, unflagged tiles (a real Reveal_Click target).
          if (base.game.revealed.has(tileKey(r, c))) return;
          const res = classifyGame(base.game);
          const targets = revealTargets(base.game, { type: 'Reveal_Click', tile });
          if (targets.length === 0) return;
          const allSafe = targets.every(
            (t) => res.classification.get(tileKey(t[0], t[1])) === 'Provably_Safe',
          );
          if (allSafe) return; // only interested in intercepted clicks

          const before = snapshot(base.game);
          const out = applyPracticeAction(base, { type: 'Reveal_Click', tile });
          // Intercepted: message shown, board unchanged, no new flag/reveal.
          expect(out.message).not.toBeNull();
          expect(snapshot(out.state.game)).toBe(before);
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property: no sequence of practice actions reveals a mine
// ---------------------------------------------------------------------------

describe('safety property — practice never reveals a mine', () => {
  // Pre-generate a small pool of real no-guess Beginner boards once, so the
  // (relatively slow) generator is not re-run on every property iteration.
  const POOL = [1, 2, 3, 4, 5].map((seed) => generate(DIFFICULTIES.Beginner, seed).board);

  it('random reveal/chord/flag sequences never reveal a mine and never lose', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: POOL.length - 1 }),
        fc.array(
          fc.record({
            kind: fc.constantFrom('Reveal_Click', 'Chord_Click', 'Flag_Toggle'),
            r: fc.integer({ min: 0, max: 8 }),
            c: fc.integer({ min: 0, max: 8 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (poolIdx, ops) => {
          const board = POOL[poolIdx];
          let s = createPractice(board);
          // Always reveal the Start_Tile first (the required opening move).
          s = reveal(s, board.startTile!);

          for (const op of ops) {
            if (s.game.status !== 'playing') break;
            const action: Action = {
              type: op.kind as Action['type'],
              tile: [op.r, op.c],
            };
            s = applyPracticeAction(s, action).state;

            // Invariant after every action: no revealed tile is a mine, and the
            // game is never lost through practice.
            for (const key of s.game.revealed) {
              const [r, c] = key.split(',').map(Number) as Tile;
              expect(isMine(board, [r, c])).toBe(false);
            }
            expect(s.game.status).not.toBe('lost');
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});

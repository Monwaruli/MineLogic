/**
 * Tests for the Metrics_Engine.
 *
 * - Replay reproduces the game's final Board_State and outcome.
 * - Two computations on the same Board + Move_Log give identical results.
 * - Logical_Move_Rate is always in [0, 100]; a fully logical game on a no-guess
 *   board gives 100.0; Chording_Efficiency is not-available for non-won games.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.10, 8.13, 9.1, 9.2, 9.8
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { numberAt, tileKey, type Board, type Tile } from './board';
import { DIFFICULTIES } from './board';
import {
  applyAction,
  createGame,
  type Action,
  type GameState,
} from './game';
import { classify, type BoardState } from './solver';
import { generate } from './generator';
import { computeMetrics, METRICS_VERSION } from './metrics';
import type { MoveLog } from './moveLog';

const RUNS = 40;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the Solver's BoardState from a GameState. */
function solverStateOf(state: GameState): BoardState {
  const { board } = state;
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
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
 * Play a no-guess Board to a win using only Provably_Safe Reveal_Clicks, and
 * return both the final GameState and the Move_Log built from its actions. Every
 * reveal here is a Logical_Move by construction.
 */
function logicalPlaythrough(board: Board): { state: GameState; log: MoveLog } {
  let state = createGame(board, 0);
  const actions: Array<{ action: Action; t: number }> = [];
  let t = 1;

  const start = board.startTile!;
  state = applyAction(state, { type: 'Reveal_Click', tile: start }, t);
  actions.push({ action: { type: 'Reveal_Click', tile: start }, t });
  t++;

  // Repeatedly reveal every Provably_Safe covered Tile until the game ends.
  for (let guard = 0; guard < 10000 && state.status === 'playing'; guard++) {
    const result = classify(solverStateOf(state));
    let progressed = false;
    for (const [key, cls] of result.classification) {
      if (cls !== 'Provably_Safe') continue;
      if (state.revealed.has(key)) continue;
      const comma = key.indexOf(',');
      const tile: Tile = [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
      const action: Action = { type: 'Reveal_Click', tile };
      const next = applyAction(state, action, t);
      // Only record and advance if the reveal actually changed state (it may
      // have been swallowed by an earlier cascade this round).
      if (next !== state) {
        actions.push({ action, t });
        t++;
        state = next;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  const entries = actions.map(({ action, t: at }, i) => {
    const prior = state.moveLog[i];
    return {
      type: action.type,
      tile: action.tile,
      elapsedMs: prior ? prior.elapsedMs : at,
      wastedClick: prior ? prior.wastedClick : false,
    };
  });
  const log: MoveLog = {
    boardId: board.id,
    entries,
    end: { outcome: state.status === 'won' ? 'won' : 'lost', endMs: t },
  };
  return { state, log };
}

/** Replay a Move_Log with the Board_Engine and return the final GameState. */
function replay(board: Board, log: MoveLog): GameState {
  let state = createGame(board, 0);
  for (const e of log.entries) {
    state = applyAction(state, { type: e.type, tile: e.tile }, e.elapsedMs);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Property tests on generated no-guess boards
// ---------------------------------------------------------------------------

describe('metrics - replay and logical play', () => {
  it('replay reproduces the final Board_State and outcome (Req 9.8)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (seed) => {
        const { board } = generate(DIFFICULTIES.Beginner, seed);
        const { state, log } = logicalPlaythrough(board);
        const replayed = replay(board, log);
        expect(replayed.status).toBe(state.status);
        expect([...replayed.revealed].sort()).toEqual([...state.revealed].sort());
        expect([...replayed.flags].sort()).toEqual([...state.flags].sort());
      }),
      { numRuns: RUNS },
    );
  });

  it('a fully logical no-guess game gives Logical_Move_Rate 100.0 and a win (Req 8.12)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (seed) => {
        const { board } = generate(DIFFICULTIES.Beginner, seed);
        const { state, log } = logicalPlaythrough(board);
        // The generator guarantees a no-guess board, so logical play wins.
        expect(state.status).toBe('won');
        const m = computeMetrics(board, log);
        expect(m.logicalMoveRate).toBe(100.0);
        expect(m.guesses).toBe(0);
        expect(m.partial).toBe(false);
        // Won game: Chording_Efficiency is available.
        expect(m.chordingEfficiency).not.toBeNull();
      }),
      { numRuns: RUNS },
    );
  });

  it('computes identical metrics twice (determinism, Req 9.2)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (seed) => {
        const { board } = generate(DIFFICULTIES.Beginner, seed);
        const { log } = logicalPlaythrough(board);
        expect(computeMetrics(board, log)).toEqual(computeMetrics(board, log));
      }),
      { numRuns: RUNS },
    );
  });

  it('Logical_Move_Rate always lies in [0, 100] for arbitrary play', () => {
    const actionArb = (w: number, h: number): fc.Arbitrary<Action> =>
      fc.record({
        type: fc.constantFrom<Action['type']>('Reveal_Click', 'Flag_Toggle', 'Chord_Click'),
        tile: fc.tuple(
          fc.integer({ min: 0, max: h - 1 }),
          fc.integer({ min: 0, max: w - 1 }),
        ) as fc.Arbitrary<Tile>,
      });

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.array(fc.integer({ min: 0, max: 80 }), { minLength: 0, maxLength: 25 }),
        (seed, picks) => {
          const { board } = generate(DIFFICULTIES.Beginner, seed);
          let state = createGame(board, 0);
          const entries = [];
          let t = 1;
          // Reveal the Start_Tile first so later actions are honored.
          {
            const a: Action = { type: 'Reveal_Click', tile: board.startTile! };
            state = applyAction(state, a, t);
            entries.push({ type: a.type, tile: a.tile, elapsedMs: t, wastedClick: false });
            t++;
          }
          const arb = actionArb(board.width, board.height);
          for (const p of picks) {
            if (state.status !== 'playing') break;
            const a = fc.sample(arb, { seed: p, numRuns: 1 })[0];
            const next = applyAction(state, a, t);
            const last = next.moveLog[next.moveLog.length - 1];
            if (next !== state && last) {
              entries.push({ type: a.type, tile: a.tile, elapsedMs: t, wastedClick: last.wastedClick });
              t++;
            }
            state = next;
          }
          const log: MoveLog = { boardId: board.id, entries };
          const m = computeMetrics(board, log);
          if (m.logicalMoveRate !== null) {
            expect(m.logicalMoveRate).toBeGreaterThanOrEqual(0);
            expect(m.logicalMoveRate).toBeLessThanOrEqual(100);
          }
          expect(m.metricsVersion).toBe(METRICS_VERSION);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests on fixed boards
// ---------------------------------------------------------------------------

describe('metrics - fixed boards', () => {
  it('reports Chording_Efficiency as not-available for a lost game, but still reports 3BV and Total_Clicks', () => {
    // 3x5 wall board: start (0,0), mines in column 2. Reveal a mine to lose.
    const board: Board = {
      id: 'wall',
      width: 5,
      height: 3,
      mines: [[0, 2], [1, 2], [2, 2]],
      startTile: [0, 0],
    };
    const log: MoveLog = {
      boardId: 'wall',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false },
        { type: 'Reveal_Click', tile: [0, 2], elapsedMs: 500, wastedClick: false }, // mine
      ],
      end: { outcome: 'lost', endMs: 600 },
    };
    const m = computeMetrics(board, log);
    expect(m.outcome).toBe('lost');
    expect(m.chordingEfficiency).toBeNull();
    expect(m.threeBV).toBeGreaterThan(0);
    expect(m.totalClicks).toBe(2);
  });

  it('excludes the Start_Tile reveal from the Logical_Move_Rate and counts clicks by type', () => {
    const board: Board = {
      id: 'wall',
      width: 5,
      height: 3,
      mines: [[0, 2], [1, 2], [2, 2]],
      startTile: [0, 0],
    };
    const log: MoveLog = {
      boardId: 'wall',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false },
        { type: 'Flag_Toggle', tile: [0, 2], elapsedMs: 100, wastedClick: false },
        { type: 'Reveal_Click', tile: [0, 3], elapsedMs: 200, wastedClick: false },
      ],
      end: { outcome: 'interrupted', endMs: 300 },
    };
    const m = computeMetrics(board, log);
    expect(m.clickCounts.revealClicks).toBe(2);
    expect(m.clickCounts.flagToggles).toBe(1);
    expect(m.totalClicks).toBe(3);
    // The start reveal is not counted; only the (0,3) reveal is a Counted_Reveal_Action.
    expect(m.countedReveals).toBe(1);
  });

  it('counts a flag on a safe tile as a Wrong_Flag', () => {
    // On the wall board, (0,1) is safe (no adjacent mine wall contact proven mine).
    const board: Board = {
      id: 'wall',
      width: 5,
      height: 3,
      mines: [[0, 2], [1, 2], [2, 2]],
      startTile: [0, 0],
    };
    const log: MoveLog = {
      boardId: 'wall',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false },
        // After the opening, (0,3)/(0,4) etc are covered. Flag (0,3) which is not
        // provably a mine -> Wrong_Flag.
        { type: 'Flag_Toggle', tile: [0, 3], elapsedMs: 100, wastedClick: false },
      ],
    };
    const m = computeMetrics(board, log);
    expect(m.wrongFlags).toBe(1);
  });
});

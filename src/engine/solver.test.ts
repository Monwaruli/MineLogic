/**
 * Tests for the constraint satisfaction Solver.
 *
 * Unit tests cover specific patterns and edge cases. Property tests compare the
 * Solver with brute-force enumeration on small Board_States taken from real
 * Boards, and check soundness during random safe play, flag invariance, and
 * agreement under rotation.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.7
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { neighbors, numberAt, tileKey, type Tile } from './board';
import {
  classify,
  type BoardState,
  type Classification,
  type SolveResult,
} from './solver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SimpleBoard {
  width: number;
  height: number;
  mines: Tile[];
}

/** Build a BoardState by revealing a given set of non-mine Tiles. */
function stateFromReveal(board: SimpleBoard, revealedTiles: Tile[]): BoardState {
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
  const revealed = revealedTiles.map((tile) => ({
    tile,
    number: numberAt(tile, board.width, board.height, mineSet),
  }));
  return {
    width: board.width,
    height: board.height,
    mineCount: board.mines.length,
    revealed,
  };
}

/**
 * Brute-force reference classifier: enumerate every placement of exactly
 * `mineCount` mines on the covered Tiles that matches all revealed Numbers, then
 * mark a Tile Provably_Safe if it is never a mine, Provably_Mine if always a
 * mine, and Undetermined otherwise. Returns null when no placement fits.
 */
function bruteForce(state: BoardState): Map<string, Classification> | null {
  const { width, height, mineCount } = state;
  const revealedSet = new Set<string>();
  for (const { tile } of state.revealed) revealedSet.add(tileKey(tile[0], tile[1]));

  const covered: Tile[] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!revealedSet.has(tileKey(r, c))) covered.push([r, c]);
    }
  }
  const coveredIndex = new Map<string, number>();
  covered.forEach(([r, c], i) => coveredIndex.set(tileKey(r, c), i));

  // Precompute, for each revealed Number, the covered-neighbor indices and target.
  const constraints = state.revealed.map(({ tile, number }) => {
    const idxs: number[] = [];
    for (const [nr, nc] of neighbors(tile, width, height)) {
      const idx = coveredIndex.get(tileKey(nr, nc));
      if (idx !== undefined) idxs.push(idx);
    }
    return { idxs, number };
  });

  const n = covered.length;
  const canMine = new Array<boolean>(n).fill(false);
  const canSafe = new Array<boolean>(n).fill(false);
  let any = false;

  // Enumerate all subsets of covered Tiles with exactly mineCount mines.
  const mine = new Array<boolean>(n).fill(false);
  const enumerate = (start: number, placed: number): void => {
    if (placed === mineCount) {
      // Check all constraints.
      for (const c of constraints) {
        let count = 0;
        for (const idx of c.idxs) if (mine[idx]) count++;
        if (count !== c.number) return;
      }
      any = true;
      for (let i = 0; i < n; i++) {
        if (mine[i]) canMine[i] = true;
        else canSafe[i] = true;
      }
      return;
    }
    // Not enough remaining Tiles to place the rest.
    if (n - start < mineCount - placed) return;
    for (let i = start; i < n; i++) {
      mine[i] = true;
      enumerate(i + 1, placed + 1);
      mine[i] = false;
    }
  };
  if (mineCount <= n) enumerate(0, 0);

  if (!any) return null;

  const result = new Map<string, Classification>();
  covered.forEach(([r, c], i) => {
    const key = tileKey(r, c);
    if (canMine[i] && !canSafe[i]) result.set(key, 'Provably_Mine');
    else if (canSafe[i] && !canMine[i]) result.set(key, 'Provably_Safe');
    else result.set(key, 'Undetermined');
  });
  return result;
}

/** Rotate a board and a reveal set 90 degrees clockwise. */
function rotate90(
  board: SimpleBoard,
  revealedTiles: Tile[],
): { board: SimpleBoard; revealed: Tile[] } {
  // (r, c) -> (c, height - 1 - r); new width = old height, new height = old width.
  const map = ([r, c]: Tile): Tile => [c, board.height - 1 - r];
  return {
    board: {
      width: board.height,
      height: board.width,
      mines: board.mines.map(map),
    },
    revealed: revealedTiles.map(map),
  };
}

/** A random small board with its mines, used as a source of real Board_States. */
function smallBoardArb(): fc.Arbitrary<SimpleBoard> {
  return fc
    .record({
      width: fc.integer({ min: 3, max: 5 }),
      height: fc.integer({ min: 3, max: 5 }),
    })
    .chain(({ width, height }) => {
      const cells = width * height;
      return fc
        .uniqueArray(fc.integer({ min: 0, max: cells - 1 }), {
          minLength: 1,
          maxLength: Math.max(1, cells - 1),
        })
        .map((idxs) => ({
          width,
          height,
          mines: idxs.map((i) => [Math.floor(i / width), i % width] as Tile),
        }));
    });
}

/** The set of all non-mine Tiles of a board. */
function safeTiles(board: SimpleBoard): Tile[] {
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
  const result: Tile[] = [];
  for (let r = 0; r < board.height; r++) {
    for (let c = 0; c < board.width; c++) {
      if (!mineSet.has(tileKey(r, c))) result.push([r, c]);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('classify - unit patterns', () => {
  it('proves a mine when a number equals its covered-neighbor count (single-number rule)', () => {
    // 3x1 column: mine at (0,0). Reveal (1,0) (sees 1) and (2,0) (sees 0).
    // (2,0)'s zero clears its neighbor (1,0) already revealed, leaving (1,0)'s
    // single mine to fall on its only remaining covered neighbor (0,0).
    const board: SimpleBoard = { width: 1, height: 3, mines: [[0, 0]] };
    const state = stateFromReveal(board, [[1, 0], [2, 0]]);
    const { classification, inconsistent } = classify(state);
    expect(inconsistent).toBe(false);
    expect(classification.get(tileKey(0, 0))).toBe('Provably_Mine');
  });

  it('leaves a 50/50 undetermined', () => {
    // 2x1 column, 1 mine, nothing revealed except via total count only -> both
    // tiles undetermined. Use a 1x2 with one mine and no revealed numbers.
    const state: BoardState = {
      width: 2,
      height: 1,
      mineCount: 1,
      revealed: [],
    };
    const { classification } = classify(state);
    expect(classification.get(tileKey(0, 0))).toBe('Undetermined');
    expect(classification.get(tileKey(0, 1))).toBe('Undetermined');
  });

  it('uses the total mine count to prove the last tiles', () => {
    // 1x3, 1 mine. Reveal (0,1) with number 0 -> neighbors (0,0),(0,2) safe,
    // so the single mine has nowhere among revealed neighbors. Instead reveal
    // (0,0) seeing 0: then (0,1) safe; the one mine must be at (0,2).
    const board: SimpleBoard = { width: 3, height: 1, mines: [[0, 2]] };
    const state = stateFromReveal(board, [[0, 0]]);
    const { classification } = classify(state);
    expect(classification.get(tileKey(0, 1))).toBe('Provably_Safe');
    expect(classification.get(tileKey(0, 2))).toBe('Provably_Mine');
  });

  it('reports inconsistency when numbers cannot be satisfied', () => {
    // Claim a revealed number larger than its covered neighbors can hold.
    const state: BoardState = {
      width: 2,
      height: 1,
      mineCount: 1,
      revealed: [{ tile: [0, 0], number: 5 }],
    };
    const { inconsistent } = classify(state);
    expect(inconsistent).toBe(true);
  });

  it('classifies nothing when there are no covered tiles', () => {
    const state: BoardState = {
      width: 1,
      height: 1,
      mineCount: 0,
      revealed: [{ tile: [0, 0], number: 0 }],
    };
    const { classification, inconsistent, inexact } = classify(state);
    expect(classification.size).toBe(0);
    expect(inconsistent).toBe(false);
    expect(inexact).toBe(false);
  });

  it('does not over-claim across components sharing tiles (regression)', () => {
    // Two revealed Numbers whose covered-neighbor sets overlap form a single
    // component. A backtracking bug once let the component report impossible
    // mine counts (e.g. 3 mines for two "1" Numbers), which made the Solver
    // mark tiles Provably_Safe/Provably_Mine that are really Undetermined. Here
    // (0,0) is in fact a mine, so classifying it as safe is an unsound error.
    const board: SimpleBoard = { width: 4, height: 5, mines: [[2, 0], [0, 0], [1, 3]] };
    const state = stateFromReveal(board, [[0, 1], [0, 2]]);
    const brute = bruteForce(state)!;
    const { classification, inconsistent } = classify(state);
    expect(inconsistent).toBe(false);
    for (const [key, cls] of brute) {
      expect(classification.get(key)).toBe(cls);
    }
    // Spell out the key case: (0,0) must not be proven safe (it is a mine).
    expect(classification.get(tileKey(0, 0))).toBe('Undetermined');
  });

  it('matches brute force on the reported 5x4 counterexample (regression)', () => {
    // Reported counterexample: a 5-wide by 4-high board with mines at (2,2) and
    // (0,0), with (1,1) and (3,3) revealed. The Solver must agree with the
    // brute-force reference on every covered Tile.
    const board: SimpleBoard = { width: 5, height: 4, mines: [[2, 2], [0, 0]] };
    const state = stateFromReveal(board, [[1, 1], [3, 3]]);
    const brute = bruteForce(state)!;
    const { classification, inconsistent } = classify(state);
    expect(inconsistent).toBe(false);
    for (const [key, cls] of brute) {
      expect(classification.get(key)).toBe(cls);
    }
  });

  it('stays sound on a reported soundness counterexample (regression)', () => {
    // 4x4, mines at (1,3),(0,0),(0,1); reveal (1,2) and (2,2). The Solver once
    // classified tiles as the opposite of their truth here.
    const board: SimpleBoard = { width: 4, height: 4, mines: [[1, 3], [0, 0], [0, 1]] };
    const state = stateFromReveal(board, [[1, 2], [2, 2]]);
    const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
    const { classification, inconsistent } = classify(state);
    expect(inconsistent).toBe(false);
    for (const [key, cls] of classification) {
      if (cls === 'Provably_Safe') expect(mineSet.has(key)).toBe(false);
      else if (cls === 'Provably_Mine') expect(mineSet.has(key)).toBe(true);
    }
  });

  it('solves a 1-2-1 style subset deduction', () => {
    // Build a case where the subset rule proves a safe tile. 3x3 with mines at
    // (0,0) and (0,2). Reveal the whole bottom two rows.
    const board: SimpleBoard = { width: 3, height: 3, mines: [[0, 0], [0, 2]] };
    const reveal: Tile[] = [
      [1, 0], [1, 1], [1, 2],
      [2, 0], [2, 1], [2, 2],
    ];
    const state = stateFromReveal(board, reveal);
    const brute = bruteForce(state)!;
    const { classification } = classify(state);
    for (const [key, cls] of brute) {
      expect(classification.get(key)).toBe(cls);
    }
  });
});

// ---------------------------------------------------------------------------
// Property tests (~100 runs each)
// ---------------------------------------------------------------------------

const RUNS = 100;

describe('classify - properties', () => {
  it('matches brute-force enumeration on small Board_States (Req 4.1, 4.3)', () => {
    fc.assert(
      fc.property(
        smallBoardArb().chain((board) => {
          const safe = safeTiles(board);
          // Reveal a random subset of safe tiles (a real play reveals safe tiles).
          return fc
            .subarray(safe, { minLength: 0, maxLength: safe.length })
            .map((revealed) => ({ board, revealed }));
        }),
        ({ board, revealed }) => {
          const state = stateFromReveal(board, revealed);
          // Keep covered-tile count manageable for brute force (<= ~16).
          const coveredCount = board.width * board.height - revealed.length;
          fc.pre(coveredCount <= 16);

          const brute = bruteForce(state);
          const result = classify(state);
          // The source board is a real configuration, so a solution must exist.
          expect(result.inconsistent).toBe(false);
          expect(result.inexact).toBe(false);
          expect(brute).not.toBeNull();
          for (const [key, cls] of brute!) {
            expect(result.classification.get(key)).toBe(cls);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('is sound during random safe play (Req 4.4)', () => {
    fc.assert(
      fc.property(
        smallBoardArb().chain((board) => {
          const safe = safeTiles(board);
          return fc
            .subarray(safe, { minLength: 1, maxLength: safe.length })
            .map((revealed) => ({ board, revealed }));
        }),
        ({ board, revealed }) => {
          const state = stateFromReveal(board, revealed);
          const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
          const result = classify(state);
          fc.pre(!result.inconsistent);
          for (const [key, cls] of result.classification) {
            if (cls === 'Provably_Safe') {
              expect(mineSet.has(key)).toBe(false);
            } else if (cls === 'Provably_Mine') {
              expect(mineSet.has(key)).toBe(true);
            }
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('is invariant to flags: flags are not part of the input (Req 4.2)', () => {
    // The BoardState type has no flag field, so flag-invariance holds by
    // construction. This property confirms that classify depends only on the
    // revealed tiles and mine count by re-running on an equivalent state built
    // from the same reveal set in a shuffled order.
    fc.assert(
      fc.property(
        smallBoardArb().chain((board) => {
          const safe = safeTiles(board);
          return fc
            .subarray(safe, { minLength: 0, maxLength: safe.length })
            .chain((revealed) =>
              fc.shuffledSubarray(revealed, {
                minLength: revealed.length,
                maxLength: revealed.length,
              }).map((shuffled) => ({ board, revealed, shuffled })),
            );
        }),
        ({ board, revealed, shuffled }) => {
          const a = classify(stateFromReveal(board, revealed));
          const b = classify(stateFromReveal(board, shuffled));
          expect(b.inconsistent).toBe(a.inconsistent);
          for (const [key, cls] of a.classification) {
            expect(b.classification.get(key)).toBe(cls);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('agrees under 90-degree rotation (Req 4.1)', () => {
    fc.assert(
      fc.property(
        smallBoardArb().chain((board) => {
          const safe = safeTiles(board);
          return fc
            .subarray(safe, { minLength: 0, maxLength: safe.length })
            .map((revealed) => ({ board, revealed }));
        }),
        ({ board, revealed }) => {
          const base = classify(stateFromReveal(board, revealed));
          const rot = rotate90(board, revealed);
          const rotated = classify(stateFromReveal(rot.board, rot.revealed));

          expect(rotated.inconsistent).toBe(base.inconsistent);
          // Map each original covered tile to its rotated position and compare.
          for (const [key, cls] of base.classification) {
            const [r, c] = key.split(',').map(Number);
            const rotatedKey = tileKey(c, board.height - 1 - r);
            expect(rotated.classification.get(rotatedKey)).toBe(cls);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('respects monotonicity: safe tiles stay safe after more safe reveals (Req 4.5)', () => {
    fc.assert(
      fc.property(
        smallBoardArb().chain((board) => {
          const safe = safeTiles(board);
          return fc
            .subarray(safe, { minLength: 0, maxLength: safe.length })
            .chain((first) => {
              const rest = safe.filter(
                (t) => !first.some((f) => f[0] === t[0] && f[1] === t[1]),
              );
              return fc
                .subarray(rest, { minLength: 0, maxLength: rest.length })
                .map((extra) => ({ board, first, second: [...first, ...extra] }));
            });
        }),
        ({ board, first, second }) => {
          const a = classify(stateFromReveal(board, first));
          const b = classify(stateFromReveal(board, second));
          fc.pre(!a.inconsistent && !b.inconsistent);
          const secondRevealed = new Set(second.map(([r, c]) => tileKey(r, c)));
          for (const [key, cls] of a.classification) {
            if (cls === 'Provably_Safe' && !secondRevealed.has(key)) {
              expect(b.classification.get(key)).toBe('Provably_Safe');
            }
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// Keep a reference to SolveResult so the type import is used in this file even
// if assertions change; avoids an unused-import error under strict settings.
export type _SolveResultRef = SolveResult;

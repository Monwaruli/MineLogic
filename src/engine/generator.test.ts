/**
 * Tests for the no-guess Board_Generator.
 *
 * Covers determinism, the Difficulty shape (size, mine count, zero-Number
 * Start_Tile), the core no-guess guarantee (every Board is cleared by the
 * Solver alone with no Inexact_State), the always-a-safe-move property along
 * the canonical solve, and that stored 3BV matches a direct recomputation.
 *
 * Property runs are kept small (a handful of seeds per Difficulty) so the suite
 * stays fast while still exercising all three sizes.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { describe, it, expect } from 'vitest';
import {
  neighbors,
  numberAt,
  tileKey,
  DIFFICULTIES,
  type Board,
  type Difficulty,
  type Tile,
} from './board';
import { classify, type BoardState } from './solver';
import { generate, GENERATOR_VERSION } from './generator';
import { threeBV } from './threeBV';

/** Reveal a Tile and flood its Opening, mirroring the engine's cascade. */
function cascadeReveal(
  start: Tile,
  mines: Set<string>,
  revealed: Set<string>,
  width: number,
  height: number,
): void {
  const stack: Tile[] = [start];
  while (stack.length > 0) {
    const t = stack.pop()!;
    const key = tileKey(t[0], t[1]);
    if (revealed.has(key) || mines.has(key)) continue;
    revealed.add(key);
    if (numberAt(t, width, height, mines) === 0) {
      for (const nb of neighbors(t, width, height)) stack.push(nb);
    }
  }
}

/** Build the Solver's BoardState from a revealed set. */
function buildState(
  revealed: Set<string>,
  mines: Set<string>,
  width: number,
  height: number,
  mineCount: number,
): BoardState {
  const list: Array<{ tile: Tile; number: number }> = [];
  for (const key of revealed) {
    const [r, c] = key.split(',').map(Number) as [number, number];
    list.push({ tile: [r, c], number: numberAt([r, c], width, height, mines) });
  }
  return { width, height, mineCount, revealed: list };
}

interface SolveTrace {
  cleared: boolean;
  inexact: boolean;
  /** True if every intermediate state offered at least one Provably_Safe Tile. */
  alwaysHadSafeMove: boolean;
}

/**
 * Replay the Canonical_Solve_Path independently of the generator's internals:
 * reveal the Start_Tile's Opening, then repeatedly classify and reveal every
 * Provably_Safe Tile until cleared, stuck, or inexact.
 */
function canonicalSolve(board: Board): SolveTrace {
  const { width, height } = board;
  const mines = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
  const mineCount = board.mines.length;
  const totalSafe = width * height - mineCount;
  const revealed = new Set<string>();

  cascadeReveal(board.startTile!, mines, revealed, width, height);

  let alwaysHadSafeMove = true;
  for (;;) {
    if (revealed.size === totalSafe) {
      return { cleared: true, inexact: false, alwaysHadSafeMove };
    }
    const result = classify(buildState(revealed, mines, width, height, mineCount));
    if (result.inexact) {
      return { cleared: false, inexact: true, alwaysHadSafeMove };
    }
    let safeCount = 0;
    const toReveal: Tile[] = [];
    for (const [key, cls] of result.classification) {
      if (cls === 'Provably_Safe' && !revealed.has(key)) {
        safeCount++;
        const [r, c] = key.split(',').map(Number) as [number, number];
        toReveal.push([r, c]);
      }
    }
    if (safeCount === 0) {
      alwaysHadSafeMove = false;
      return { cleared: false, inexact: false, alwaysHadSafeMove };
    }
    for (const t of toReveal) cascadeReveal(t, mines, revealed, width, height);
  }
}

/** Assert the general Board invariants for a Difficulty. */
function assertDifficultyShape(board: Board, difficulty: Difficulty): void {
  expect(board.width).toBe(difficulty.width);
  expect(board.height).toBe(difficulty.height);
  expect(board.mines.length).toBe(difficulty.mines);
  expect(board.startTile).toBeDefined();

  // The Start_Tile has no adjacent mines (Number 0).
  const mines = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
  const start = board.startTile!;
  expect(mines.has(tileKey(start[0], start[1]))).toBe(false);
  expect(numberAt(start, board.width, board.height, mines)).toBe(0);

  // Mines are distinct and in bounds.
  const seen = new Set<string>();
  for (const [r, c] of board.mines) {
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(board.height);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThan(board.width);
    const key = tileKey(r, c);
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }
}

// A few small seeds per Difficulty. Beginner/Intermediate solve quickly;
// Expert is the slow one, so it gets fewer seeds.
const SEEDS: Record<string, number[]> = {
  Beginner: [1, 2, 3, 4, 5],
  Intermediate: [1, 2, 3],
  Expert: [1, 2],
};

describe('generate - determinism', () => {
  it('produces an identical Board for the same (difficulty, seed)', () => {
    for (const difficulty of Object.values(DIFFICULTIES)) {
      for (const seed of SEEDS[difficulty.name]) {
        const a = generate(difficulty, seed);
        const b = generate(difficulty, seed);
        expect(a.board).toEqual(b.board);
        expect(a.metadata).toEqual(b.metadata);
        expect(a.metadata.generatorVersion).toBe(GENERATOR_VERSION);
        expect(a.metadata.seed).toBe(seed);
      }
    }
  });
});

describe('generate - Board shape (Req 5.1)', () => {
  it('matches each Difficulty and gives a zero-Number Start_Tile', () => {
    for (const difficulty of Object.values(DIFFICULTIES)) {
      for (const seed of SEEDS[difficulty.name]) {
        const { board } = generate(difficulty, seed);
        assertDifficultyShape(board, difficulty);
      }
    }
  });
});

describe('generate - no-guess guarantee (Req 5.2, 5.3)', () => {
  it('every generated Board is fully solvable by the Solver with no inexact state', () => {
    for (const difficulty of Object.values(DIFFICULTIES)) {
      for (const seed of SEEDS[difficulty.name]) {
        const { board } = generate(difficulty, seed);
        const trace = canonicalSolve(board);
        expect(trace.inexact).toBe(false);
        expect(trace.cleared).toBe(true);
      }
    }
  });

  it('every intermediate state has at least one Provably_Safe Tile (always-a-safe-move)', () => {
    for (const difficulty of Object.values(DIFFICULTIES)) {
      for (const seed of SEEDS[difficulty.name]) {
        const { board } = generate(difficulty, seed);
        const trace = canonicalSolve(board);
        expect(trace.alwaysHadSafeMove).toBe(true);
      }
    }
  });
});

describe('generate - metadata (Req 5.5)', () => {
  it('stores a 3BV that matches a direct recomputation', () => {
    for (const difficulty of Object.values(DIFFICULTIES)) {
      for (const seed of SEEDS[difficulty.name]) {
        const { board, metadata } = generate(difficulty, seed);
        expect(metadata.threeBV).toBe(threeBV(board));
        expect(metadata.threeBV).toBeGreaterThan(0);
      }
    }
  });
});

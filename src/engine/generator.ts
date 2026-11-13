/**
 * The no-guess Board_Generator.
 *
 * `generate(difficulty, seed)` builds a Board that the Solver can clear by pure
 * logic from the Start_Tile, never forcing a guess. It is deterministic: the
 * same `difficulty`, `seed`, and `GENERATOR_VERSION` always produce the same
 * Board. All randomness comes from `rng.ts`, never `Math.random`.
 *
 * Pure: no React, DOM, or Web Worker imports, so it runs directly in tests,
 * tools, and inside a Worker. See the Design Notes in tasks.md and Requirement
 * 5.
 *
 * Strategy:
 *  1. Pick a Start_Tile and place the Difficulty's mine count uniformly at
 *     random outside the Start_Tile and its Neighbors (so the Start_Tile has
 *     Number 0 and opens a region).
 *  2. Check the layout: reveal the Start_Tile's Opening, then repeatedly ask
 *     the Solver to classify the current Board_State and reveal every
 *     Provably_Safe Tile (with its Cascade). This is the Canonical_Solve_Path.
 *  3. If every non-mine Tile ends up revealed with no Inexact_State, keep the
 *     Board. If the check gets stuck or goes Inexact, optionally perturb one
 *     mine (see `generate`'s `perturb` option) and re-check, otherwise reject
 *     the layout and draw the next one from the same PRNG.
 */

import {
  neighbors,
  numberAt,
  tileKey,
  type Board,
  type Difficulty,
  type Tile,
} from './board';
import { classify, type BoardState } from './solver';
import { createRng, type Rng } from './rng';
import { threeBV } from './threeBV';

/**
 * Generator version. Bump this whenever a change would alter the Board produced
 * for a given seed, so stored seeds stay reproducible against the right code.
 */
export const GENERATOR_VERSION = 1;

/** Metadata stored beside a generated Board. */
export interface BoardMetadata {
  /** The seed the Board was generated from. */
  seed: number;
  /** The generator version that produced it. */
  generatorVersion: number;
  /** The Board's 3BV. */
  threeBV: number;
}

/** A generated Board together with its metadata. */
export interface GeneratedBoard {
  board: Board;
  metadata: BoardMetadata;
}

/** Options for `generate`. */
export interface GenerateOptions {
  /**
   * When true, a stuck/Inexact layout is first retried by moving one mine from
   * beside the solve frontier to a covered Tile that borders no revealed
   * Number (same PRNG), before the layout is rejected. This rescues otherwise
   * hard Expert layouts and cuts generation time. Defaults to true.
   */
  perturb?: boolean;
  /**
   * Safety cap on how many fresh layouts to draw before giving up. Generation
   * is effectively unbounded in theory; this keeps a pathological seed from
   * looping forever. Defaults to a large value that real seeds never reach.
   */
  maxAttempts?: number;
  /** Per-layout cap on perturbation moves before the layout is abandoned. */
  maxPerturbations?: number;
}

/** A mine layout under construction, as a `"row,col"` key set. */
type MineSet = Set<string>;

/**
 * Generate a No_Guess Board for `difficulty` from `seed`.
 *
 * Deterministic in `(difficulty, seed, GENERATOR_VERSION)`. Throws if no
 * solvable layout is found within `maxAttempts` (not expected for real seeds).
 */
export function generate(
  difficulty: Difficulty,
  seed: number,
  options: GenerateOptions = {},
): GeneratedBoard {
  const perturb = options.perturb ?? true;
  const maxAttempts = options.maxAttempts ?? 100_000;
  const maxPerturbations = options.maxPerturbations ?? 64;

  const rng = createRng(seed);
  const { width, height, mines: mineCount } = difficulty;

  // The Start_Tile is fixed per seed by the first draws, so determinism holds.
  const startTile = pickStartTile(rng, width, height);
  const forbidden = startRegion(startTile, width, height);

  // Candidate interior cells where mines may go (everything but the Start_Tile
  // and its Neighbors), as flat indices.
  const placeable: number[] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!forbidden.has(tileKey(r, c))) placeable.push(r * width + c);
    }
  }
  if (mineCount > placeable.length) {
    throw new RangeError(
      `Difficulty "${difficulty.name}" needs ${mineCount} mines but only ` +
        `${placeable.length} cells are available outside the start region.`,
    );
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let mines = placeMines(rng, placeable, mineCount, width);

    // First check.
    let check = solveCheck(mines, startTile, width, height, mineCount);
    if (check.cleared) {
      return finish(mines, startTile, width, height, seed);
    }

    // Optional perturbation loop: nudge a mine off the stuck frontier.
    if (perturb && !check.inexact) {
      // Only perturb when stuck (not when the solver ran out of budget), since
      // an Inexact_State means the layout is genuinely hard to verify.
      let moved = true;
      let steps = 0;
      while (moved && steps < maxPerturbations) {
        const next = perturbOnce(rng, mines, check, forbidden, width, height);
        if (!next) break;
        mines = next;
        steps++;
        moved = true;
        check = solveCheck(mines, startTile, width, height, mineCount);
        if (check.cleared) {
          return finish(mines, startTile, width, height, seed);
        }
        if (check.inexact) break;
      }
    }

    // Reject: the next layout is drawn from the same PRNG on the next loop.
  }

  throw new Error(
    `Board_Generator gave up after ${maxAttempts} attempts for difficulty ` +
      `"${difficulty.name}" seed ${seed}.`,
  );
}

/** Build the final Board and metadata from an accepted mine layout. */
function finish(
  mines: MineSet,
  startTile: Tile,
  width: number,
  height: number,
  seed: number,
): GeneratedBoard {
  const mineTiles = keysToTiles(mines);
  // Row-major order by convention (Board.mines).
  mineTiles.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const board: Board = {
    id: `gen-${seed}-v${GENERATOR_VERSION}`,
    width,
    height,
    mines: mineTiles,
    startTile,
  };
  return {
    board,
    metadata: {
      seed,
      generatorVersion: GENERATOR_VERSION,
      threeBV: threeBV(board),
    },
  };
}

/** Pick the Start_Tile deterministically from the PRNG. */
function pickStartTile(rng: Rng, width: number, height: number): Tile {
  const r = rng.nextInt(height);
  const c = rng.nextInt(width);
  return [r, c];
}

/** The Start_Tile and its Neighbors: cells that must stay mine-free. */
function startRegion(start: Tile, width: number, height: number): Set<string> {
  const region = new Set<string>([tileKey(start[0], start[1])]);
  for (const [r, c] of neighbors(start, width, height)) region.add(tileKey(r, c));
  return region;
}

/**
 * Place `mineCount` mines uniformly at random among `placeable` flat indices
 * using a partial Fisher-Yates shuffle driven by the PRNG. Returns a key set.
 */
function placeMines(
  rng: Rng,
  placeable: number[],
  mineCount: number,
  width: number,
): MineSet {
  // Copy so the shared `placeable` array is never mutated across attempts.
  const pool = placeable.slice();
  const mines: MineSet = new Set();
  for (let i = 0; i < mineCount; i++) {
    const j = i + rng.nextInt(pool.length - i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    const flat = pool[i];
    const r = Math.floor(flat / width);
    const c = flat % width;
    mines.add(tileKey(r, c));
  }
  return mines;
}

/** Result of a canonical-solve check over a mine layout. */
interface CheckResult {
  /** True when every non-mine Tile was revealed by pure logic. */
  cleared: boolean;
  /** True when the Solver hit an Inexact_State at some step. */
  inexact: boolean;
  /** The revealed Tiles at the point the check stopped (for perturbation). */
  revealed: Set<string>;
}

/**
 * Run the Canonical_Solve_Path: reveal the Start_Tile's Opening, then loop
 * asking the Solver to classify and revealing every Provably_Safe Tile with its
 * Cascade until the Board is cleared, the Solver is stuck, or it goes Inexact.
 */
function solveCheck(
  mines: MineSet,
  startTile: Tile,
  width: number,
  height: number,
  mineCount: number,
): CheckResult {
  const revealed = new Set<string>();
  const totalSafe = width * height - mineCount;

  // Reveal the Start_Tile's Opening (it has Number 0 by construction).
  cascadeReveal(startTile, mines, revealed, width, height);

  // At least one safe Tile must always be classifiable until the Board clears.
  for (;;) {
    if (revealed.size === totalSafe) {
      return { cleared: true, inexact: false, revealed };
    }
    const state = buildState(revealed, mines, width, height, mineCount);
    const result = classify(state);
    if (result.inexact) {
      return { cleared: false, inexact: true, revealed };
    }
    // Reveal every Provably_Safe covered Tile, cascading through Openings.
    let progressed = false;
    for (const [key, cls] of result.classification) {
      if (cls !== 'Provably_Safe') continue;
      if (revealed.has(key)) continue;
      const [r, c] = keyToTile(key);
      cascadeReveal([r, c], mines, revealed, width, height);
      progressed = true;
    }
    if (!progressed) {
      // Stuck: no new Provably_Safe Tile though the Board is not cleared.
      return { cleared: false, inexact: false, revealed };
    }
  }
}

/**
 * Reveal a Tile and flood its Opening (8-connected through zero-Number Tiles),
 * matching the Board_Engine's cascade. Never reveals a mine.
 */
function cascadeReveal(
  start: Tile,
  mines: MineSet,
  revealed: Set<string>,
  width: number,
  height: number,
): void {
  const startKey = tileKey(start[0], start[1]);
  if (mines.has(startKey)) return; // defensive: never reveal a mine
  const stack: Tile[] = [start];
  while (stack.length > 0) {
    const tile = stack.pop()!;
    const key = tileKey(tile[0], tile[1]);
    if (revealed.has(key)) continue;
    if (mines.has(key)) continue;
    revealed.add(key);
    if (numberAt(tile, width, height, mines) === 0) {
      for (const nb of neighbors(tile, width, height)) stack.push(nb);
    }
  }
}

/** Build the Solver's BoardState from the current revealed set. */
function buildState(
  revealed: Set<string>,
  mines: MineSet,
  width: number,
  height: number,
  mineCount: number,
): BoardState {
  const revealedList: Array<{ tile: Tile; number: number }> = [];
  for (const key of revealed) {
    const [r, c] = keyToTile(key);
    revealedList.push({ tile: [r, c], number: numberAt([r, c], width, height, mines) });
  }
  return { width, height, mineCount, revealed: revealedList };
}

/**
 * Perturbation: when the check is stuck, move one mine that sits on the solve
 * frontier (a covered mine bordering a revealed Number) to a covered Tile that
 * borders no revealed Number. This changes the Numbers seen so far, which can
 * turn a guess into a deduction. All choices come from the PRNG. Returns the
 * new mine set, or null when no such move exists.
 */
function perturbOnce(
  rng: Rng,
  mines: MineSet,
  check: CheckResult,
  forbidden: Set<string>,
  width: number,
  height: number,
): MineSet | null {
  const revealed = check.revealed;

  // Covered Tiles that border at least one revealed Number (the frontier).
  const bordersRevealed = (r: number, c: number): boolean => {
    for (const [nr, nc] of neighbors([r, c], width, height)) {
      if (revealed.has(tileKey(nr, nc))) return true;
    }
    return false;
  };

  // Source candidates: mines on the frontier.
  const sources: Tile[] = [];
  for (const key of mines) {
    const [r, c] = keyToTile(key);
    if (bordersRevealed(r, c)) sources.push([r, c]);
  }

  // Destination candidates: covered, mine-free, non-start Tiles that border no
  // revealed Number (so they are in the "deep" covered area).
  const dests: Tile[] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const key = tileKey(r, c);
      if (mines.has(key)) continue;
      if (revealed.has(key)) continue;
      if (forbidden.has(key)) continue; // keep the Start region clear
      if (bordersRevealed(r, c)) continue;
      dests.push([r, c]);
    }
  }

  if (sources.length === 0 || dests.length === 0) return null;

  const src = sources[rng.nextInt(sources.length)];
  const dst = dests[rng.nextInt(dests.length)];
  const next: MineSet = new Set(mines);
  next.delete(tileKey(src[0], src[1]));
  next.add(tileKey(dst[0], dst[1]));
  return next;
}

/** Parse a `"row,col"` key into a Tile. */
function keyToTile(key: string): Tile {
  const comma = key.indexOf(',');
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

/** Convert a key set to a Tile array. */
function keysToTiles(keys: Set<string>): Tile[] {
  const tiles: Tile[] = [];
  for (const key of keys) tiles.push(keyToTile(key));
  return tiles;
}

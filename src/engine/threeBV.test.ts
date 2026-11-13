/**
 * Tests for the 3BV computation.
 *
 * Unit tests hand-count 3BV on small Boards. A property test ties 3BV to its
 * operational meaning by replaying the 3BV click model through the Board_Engine
 * and confirming the Board is won in exactly 3BV reveal clicks.
 *
 * Validates: Requirement 5.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { neighbors, numberAt, tileKey, type Board, type Tile } from './board';
import { threeBV } from './threeBV';
import { applyAction, type GameState } from './game';

/** Build a Board from a layout, with `initialRevealed` empty so nothing starts open. */
function boardOf(width: number, height: number, mines: Tile[]): Board {
  return { id: 'tbv-test', width, height, mines, initialRevealed: [] };
}

/**
 * A GameState that is already in `playing` with nothing revealed, so each
 * Reveal_Click the 3BV model issues is honored and counted. This sidesteps the
 * Start_Tile gating, which is not what the 3BV click model measures.
 */
function freshPlayingState(board: Board): GameState {
  return {
    board,
    revealed: new Set<string>(),
    flags: new Set<string>(),
    status: 'playing',
    startRevealed: true,
    startRevealedAt: 0,
    moveLog: [],
  };
}

describe('threeBV - hand-counted examples', () => {
  it('a board with no mines is a single Opening: 3BV = 1', () => {
    // 3x3, no mines -> every Tile is zero, one connected Opening.
    const board = boardOf(3, 3, []);
    expect(threeBV(board)).toBe(1);
  });

  it('a single corner mine on 3x3: no zeros, every safe Tile is its own click', () => {
    // Mine at (0,0). (2,2) has Number 0? neighbors of (2,2) are (1,1),(1,2),
    // (2,1) - none is the mine, so (2,2) is zero. Let's instead pick a layout
    // with no zeros: mine at center (1,1) makes all 8 border Tiles Number 1,
    // and there is no zero Tile, so 3BV = 8 isolated clicks.
    const board = boardOf(3, 3, [[1, 1]]);
    expect(threeBV(board)).toBe(8);
  });

  it('corner mine leaves one Opening plus no isolated clicks', () => {
    // Mine at (0,0) on 3x3. (2,2) is zero (no mine among its neighbors), so a
    // single Opening floods from (2,2) across all the zero Tiles and reveals
    // their numbered borders. The whole safe area is one Opening: 3BV = 1.
    const board = boardOf(3, 3, [[0, 0]]);
    expect(threeBV(board)).toBe(1);
  });

  it('two separated mines create numbered Tiles with still one Opening', () => {
    // 1x5 row, mines at the two ends (0,0) and (0,4). Middle (0,2) is zero;
    // (0,1) and (0,3) are Number 1 and border the zero, so one Opening covers
    // all three safe Tiles. 3BV = 1.
    const board = boardOf(5, 1, [[0, 0], [0, 4]]);
    expect(threeBV(board)).toBe(1);
  });

  it('counts isolated numbered Tiles that touch no zero', () => {
    // 1x4 row, mine at (0,1). (0,0) is Number 1, (0,2) is Number 1, (0,3) is
    // Number 0. (0,2) borders the zero (0,3) so it is covered by that Opening.
    // (0,0) borders only the mine and (0,1)'s... (0,0) neighbors: (0,1) mine.
    // (0,0) is Number 1 and touches no zero -> its own click. Opening at (0,3)
    // covers (0,2),(0,3). So 3BV = 1 (opening) + 1 (isolated (0,0)) = 2.
    const board = boardOf(4, 1, [[0, 1]]);
    expect(threeBV(board)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Property: the 3BV click model wins in exactly 3BV reveal clicks
// ---------------------------------------------------------------------------

/**
 * The 3BV click model: click one Tile in each Opening, then click every
 * remaining covered non-mine Tile. Count the reveal clicks and confirm a win.
 */
function playThreeBVModel(board: Board): number {
  const { width, height } = board;
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
  const isMine = (r: number, c: number): boolean => mineSet.has(tileKey(r, c));

  // Find one representative Tile per Opening.
  const seen = new Set<string>();
  const openingSeeds: Tile[] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (isMine(r, c)) continue;
      const key = tileKey(r, c);
      if (seen.has(key)) continue;
      if (numberAt([r, c], width, height, mineSet) !== 0) continue;
      openingSeeds.push([r, c]);
      // Flood the Opening to mark all its zero Tiles as seen.
      const stack: Tile[] = [[r, c]];
      while (stack.length > 0) {
        const t = stack.pop()!;
        const tk = tileKey(t[0], t[1]);
        if (seen.has(tk)) continue;
        seen.add(tk);
        for (const nb of neighbors(t, width, height)) {
          if (!isMine(nb[0], nb[1]) && numberAt(nb, width, height, mineSet) === 0) {
            stack.push(nb);
          }
        }
      }
    }
  }

  let state: GameState = freshPlayingState(board);
  let clicks = 0;

  // Click one Tile per Opening.
  for (const seed of openingSeeds) {
    if (state.revealed.has(tileKey(seed[0], seed[1]))) continue;
    state = applyAction(state, { type: 'Reveal_Click', tile: seed }, 0);
    clicks++;
  }

  // Click every still-covered non-mine Tile.
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (isMine(r, c)) continue;
      const key = tileKey(r, c);
      if (state.revealed.has(key)) continue;
      state = applyAction(state, { type: 'Reveal_Click', tile: [r, c] }, 0);
      clicks++;
    }
  }

  expect(state.status).toBe('won');
  return clicks;
}

/** A random small board (with a guaranteed non-mine Tile) for the click model. */
function smallBoardArb(): fc.Arbitrary<Board> {
  return fc
    .record({
      width: fc.integer({ min: 2, max: 6 }),
      height: fc.integer({ min: 2, max: 6 }),
    })
    .chain(({ width, height }) => {
      const cells = width * height;
      return fc
        .uniqueArray(fc.integer({ min: 0, max: cells - 1 }), {
          minLength: 0,
          maxLength: cells - 1, // leave at least one safe Tile
        })
        .map((idxs) => ({
          id: 'tbv-prop',
          width,
          height,
          mines: idxs.map((i) => [Math.floor(i / width), i % width] as Tile),
          initialRevealed: [] as Tile[],
        }));
    });
}

describe('threeBV - properties', () => {
  it('the 3BV click model wins in exactly 3BV reveal clicks (Req 5.5)', () => {
    fc.assert(
      fc.property(smallBoardArb(), (board) => {
        const clicks = playThreeBVModel(board);
        expect(clicks).toBe(threeBV(board));
      }),
      { numRuns: 100 },
    );
  });
});

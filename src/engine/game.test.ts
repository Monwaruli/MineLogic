/**
 * Tests for the Board_Engine.
 *
 * Unit tests cover each Requirement 1 rule. Property tests cover the invariants
 * that a revealed Tile never becomes covered again and that no action ever
 * reveals a flagged Tile.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { numberAt, tileKey, type Board, type Tile } from './board';
import {
  applyAction,
  createGame,
  mineCounter,
  type Action,
  type GameState,
} from './game';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * 3x5 board (height 3, width 5) with a vertical mine wall in the middle column.
 * The Start_Tile (0,0) is a zero, so revealing it cascades through the left
 * region (columns 0 and 1) but the wall keeps the right region (columns 3 and
 * 4) covered, so the game stays in play after the start. Layout:
 *
 *   . . M . .
 *   . . M . .
 *   . . M . .
 */
function wallBoard(): Board {
  return {
    id: 'g1',
    width: 5,
    height: 3,
    mines: [[0, 2], [1, 2], [2, 2]],
    startTile: [0, 0],
  };
}

const START: Tile = [0, 0];

/** Start the wall game and reveal the Start_Tile. */
function startedGame(now = 1000): GameState {
  const game = createGame(wallBoard(), 0);
  return applyAction(game, { type: 'Reveal_Click', tile: START }, now);
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('createGame', () => {
  it('starts a full board pending the Start_Tile with nothing revealed (Req 1.1)', () => {
    const game = createGame(wallBoard());
    expect(game.status).toBe('pending_start');
    expect(game.revealed.size).toBe(0);
    expect(game.startRevealed).toBe(false);
  });

  it('starts an initial-revealed board already playing', () => {
    const board: Board = {
      id: 'snip',
      width: 2,
      height: 2,
      mines: [[0, 0]],
      initialRevealed: [[1, 1]],
    };
    const game = createGame(board, 500);
    expect(game.status).toBe('playing');
    expect(game.startRevealed).toBe(true);
    expect(game.revealed.has(tileKey(1, 1))).toBe(true);
  });
});

describe('pre-start behavior (Req 1.2, 1.3)', () => {
  it('ignores a Reveal_Click on a non-Start_Tile and leaves it out of the Move_Log', () => {
    const game = createGame(wallBoard());
    const after = applyAction(game, { type: 'Reveal_Click', tile: [0, 1] }, 100);
    expect(after).toBe(game); // unchanged state returned
    expect(after.moveLog.length).toBe(0);
    expect(after.revealed.size).toBe(0);
  });

  it('ignores a Flag_Toggle before the Start_Tile is revealed', () => {
    const game = createGame(wallBoard());
    const after = applyAction(game, { type: 'Flag_Toggle', tile: [0, 1] }, 100);
    expect(after.flags.size).toBe(0);
    expect(after.moveLog.length).toBe(0);
  });

  it('revealing the Start_Tile zeroes the clock and reveals its Opening (Req 1.3, 1.5)', () => {
    const after = startedGame(1000);
    expect(after.startRevealed).toBe(true);
    expect(after.startRevealedAt).toBe(1000);
    expect(after.status).toBe('playing');
    // The Start_Tile (0,0) is a zero, so its Opening floods the left region
    // (columns 0 and 1); the mine wall in column 2 keeps the right region
    // covered, so the game stays in play.
    expect(after.revealed.has(tileKey(0, 0))).toBe(true);
    expect(after.revealed.has(tileKey(2, 1))).toBe(true);
    // The right region stays covered.
    expect(after.revealed.has(tileKey(0, 4))).toBe(false);
    // The first move logs with elapsed 0.
    expect(after.moveLog[0].elapsedMs).toBe(0);
  });
});

describe('Reveal_Click (Req 1.4)', () => {
  it('reveals a covered unflagged non-mine tile and logs elapsed ms', () => {
    const game = startedGame(1000);
    // (0,3) is in the covered right region and is not a mine.
    expect(game.revealed.has(tileKey(0, 3))).toBe(false);
    const after = applyAction(game, { type: 'Reveal_Click', tile: [0, 3] }, 1500);
    expect(after.revealed.has(tileKey(0, 3))).toBe(true);
    const last = after.moveLog[after.moveLog.length - 1];
    expect(last.type).toBe('Reveal_Click');
    expect(last.elapsedMs).toBe(500);
  });

  it('ignores a Reveal_Click on a flagged tile', () => {
    let game = startedGame(1000);
    // (0,2) is a covered mine in the right region; flag it, then try to reveal.
    game = applyAction(game, { type: 'Flag_Toggle', tile: [0, 2] }, 1100);
    const after = applyAction(game, { type: 'Reveal_Click', tile: [0, 2] }, 1200);
    expect(after.revealed.has(tileKey(0, 2))).toBe(false);
  });
});

describe('Flag_Toggle (Req 1.6, 1.11)', () => {
  it('places then removes a flag and updates the mine counter', () => {
    const game = startedGame(1000);
    expect(mineCounter(game)).toBe(3); // 3 mines, 0 flags
    const flagged = applyAction(game, { type: 'Flag_Toggle', tile: [0, 2] }, 1100);
    expect(flagged.flags.has(tileKey(0, 2))).toBe(true);
    expect(mineCounter(flagged)).toBe(2);
    const unflagged = applyAction(flagged, { type: 'Flag_Toggle', tile: [0, 2] }, 1200);
    expect(unflagged.flags.has(tileKey(0, 2))).toBe(false);
    expect(mineCounter(unflagged)).toBe(3);
  });

  it('ignores a Flag_Toggle on a revealed tile', () => {
    const game = startedGame(1000);
    const target = tileKey(0, 0); // revealed by the opening (the Start_Tile)
    const after = applyAction(game, { type: 'Flag_Toggle', tile: [0, 0] }, 1100);
    expect(after.flags.has(target)).toBe(false);
  });
});

/**
 * Chord fixture: 3x3 with a single mine at (0,0). (1,1) is revealed from the
 * start and sees Number 1, with (0,0) as its only mine neighbor. This gives a
 * revealed Number with covered neighbors to chord into.
 *
 *   M 1 .
 *   1 1 .
 *   . . .
 */
function chordBoard(): Board {
  return {
    id: 'c1',
    width: 3,
    height: 3,
    mines: [[0, 0]],
    initialRevealed: [[1, 1]],
  };
}

describe('Chord_Click (Req 1.7, 1.8)', () => {
  it('reveals covered unflagged neighbors when flags equal the Number', () => {
    // (1,1) sees Number 1 (mine at (0,0)). Flag (0,0), then chord (1,1).
    let game = createGame(chordBoard(), 1000);
    game = applyAction(game, { type: 'Flag_Toggle', tile: [0, 0] }, 1100);
    const after = applyAction(game, { type: 'Chord_Click', tile: [1, 1] }, 1200);
    // The covered unflagged neighbors of (1,1) should open.
    expect(after.revealed.has(tileKey(0, 1))).toBe(true);
    expect(after.revealed.has(tileKey(1, 0))).toBe(true);
    const last = after.moveLog[after.moveLog.length - 1];
    expect(last.type).toBe('Chord_Click');
    expect(last.wastedClick).toBe(false);
  });

  it('records a Wasted_Click and changes nothing when flags differ from the Number', () => {
    const game = createGame(chordBoard(), 1000);
    // No flags placed, so flagged neighbors (0) != Number (1): wasted.
    const revealedBefore = new Set(game.revealed);
    const after = applyAction(game, { type: 'Chord_Click', tile: [1, 1] }, 1200);
    expect(after.revealed.size).toBe(revealedBefore.size);
    const last = after.moveLog[after.moveLog.length - 1];
    expect(last.type).toBe('Chord_Click');
    expect(last.wastedClick).toBe(true);
  });
});

describe('win and loss (Req 1.9, 1.10)', () => {
  it('loses when a Reveal_Click hits a mine and shows every mine', () => {
    const game = startedGame(1000);
    // (0,2) is a covered mine in the right region.
    const after = applyAction(game, { type: 'Reveal_Click', tile: [0, 2] }, 1300);
    expect(after.status).toBe('lost');
    // Every mine is shown.
    expect(after.revealed.has(tileKey(0, 2))).toBe(true);
    expect(after.revealed.has(tileKey(1, 2))).toBe(true);
    expect(after.revealed.has(tileKey(2, 2))).toBe(true);
  });

  it('wins when every non-mine tile is revealed and flags every mine', () => {
    // Use a board where the opening reveals everything but the mine.
    // 2x2 with mine at (0,0) and start at (1,1): (1,1) is a 1, so it will not
    // cascade. Reveal the three safe tiles one by one.
    const board: Board = { id: 'w', width: 2, height: 2, mines: [[0, 0]], startTile: [1, 1] };
    let game = createGame(board, 0);
    game = applyAction(game, { type: 'Reveal_Click', tile: [1, 1] }, 10);
    game = applyAction(game, { type: 'Reveal_Click', tile: [0, 1] }, 20);
    game = applyAction(game, { type: 'Reveal_Click', tile: [1, 0] }, 30);
    expect(game.status).toBe('won');
    expect(game.flags.has(tileKey(0, 0))).toBe(true);
    expect(mineCounter(game)).toBe(0);
  });

  it('ignores actions after the game ends', () => {
    const lost = applyAction(startedGame(1000), { type: 'Reveal_Click', tile: [0, 2] }, 1300);
    expect(lost.status).toBe('lost');
    const after = applyAction(lost, { type: 'Flag_Toggle', tile: [0, 3] }, 1400);
    expect(after).toBe(lost);
  });
});

describe('Move_Log (Req 1.12)', () => {
  it('appends each applied action with type, tile, and elapsed ms', () => {
    let game = startedGame(1000);
    game = applyAction(game, { type: 'Flag_Toggle', tile: [0, 2] }, 1250);
    const entry = game.moveLog[game.moveLog.length - 1];
    expect(entry.type).toBe('Flag_Toggle');
    expect(entry.tile).toEqual([0, 2]);
    expect(entry.elapsedMs).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// Property tests (~100 runs each)
// ---------------------------------------------------------------------------

const RUNS = 100;

interface SimpleBoard {
  width: number;
  height: number;
  mines: Tile[];
}

/** A small board with a valid Start_Tile (a zero-Number non-mine tile). */
function boardWithStartArb(): fc.Arbitrary<{ board: Board; start: Tile }> {
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
          maxLength: Math.max(0, cells - 2),
        })
        .map((idxs) => {
          const mines: Tile[] = idxs.map((i) => [Math.floor(i / width), i % width]);
          const mineSet = new Set(mines.map(([r, c]) => tileKey(r, c)));
          let start: Tile | null = null;
          for (let r = 0; r < height && !start; r++) {
            for (let c = 0; c < width && !start; c++) {
              if (mineSet.has(tileKey(r, c))) continue;
              if (numberAt([r, c], width, height, mineSet) === 0) start = [r, c];
            }
          }
          return { mines, start, width, height };
        })
        .filter((x): x is SimpleBoard & { start: Tile } => x.start !== null)
        .map(({ width, height, mines, start }) => ({
          board: { id: 'p', width, height, mines, startTile: start } as Board,
          start,
        }));
    });
}

/** An arbitrary action on a board of the given size. */
function actionArb(width: number, height: number): fc.Arbitrary<Action> {
  return fc.record({
    type: fc.constantFrom<Action['type']>('Reveal_Click', 'Flag_Toggle', 'Chord_Click'),
    tile: fc.tuple(
      fc.integer({ min: 0, max: height - 1 }),
      fc.integer({ min: 0, max: width - 1 }),
    ) as fc.Arbitrary<Tile>,
  });
}

describe('game - invariants', () => {
  it('a revealed tile never becomes covered again', () => {
    fc.assert(
      fc.property(
        boardWithStartArb().chain(({ board, start }) =>
          fc
            .array(actionArb(board.width, board.height), { minLength: 0, maxLength: 20 })
            .map((actions) => ({ board, start, actions })),
        ),
        ({ board, start, actions }) => {
          let game = createGame(board, 0);
          game = applyAction(game, { type: 'Reveal_Click', tile: start }, 1);
          let prev = new Set(game.revealed);
          let t = 2;
          for (const action of actions) {
            game = applyAction(game, action, t++);
            for (const key of prev) {
              expect(game.revealed.has(key)).toBe(true);
            }
            prev = new Set(game.revealed);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('no action ever reveals a flagged tile', () => {
    fc.assert(
      fc.property(
        boardWithStartArb().chain(({ board, start }) =>
          fc
            .array(actionArb(board.width, board.height), { minLength: 0, maxLength: 20 })
            .map((actions) => ({ board, start, actions })),
        ),
        ({ board, start, actions }) => {
          let game = createGame(board, 0);
          game = applyAction(game, { type: 'Reveal_Click', tile: start }, 1);
          let t = 2;
          for (const action of actions) {
            const before = game;
            game = applyAction(game, action, t++);
            // Any tile that was flagged before AND still flagged after must not
            // be revealed. (A flag can only be removed by Flag_Toggle, which
            // never reveals.) More strongly: at every step, no tile is both
            // flagged and revealed.
            for (const key of game.flags) {
              expect(game.revealed.has(key)).toBe(false);
            }
            void before;
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

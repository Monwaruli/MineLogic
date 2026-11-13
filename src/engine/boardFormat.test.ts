/**
 * Tests for the Board_Parser and Board_Printer.
 *
 * Unit tests cover canonical printing and each Requirement 3.2 rejection with
 * its rule and line number. Property tests cover the round-trip property
 * (print -> parse -> print is stable and the parsed Board equals the original)
 * and that any text the parser accepts re-prints to text the parser accepts.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { numberAt, tileKey, type Board, type Tile } from './board';
import { BoardFormatError, parseBoard, printBoard } from './boardFormat';

const RUNS = 100;

// ---------------------------------------------------------------------------
// Unit tests: printing
// ---------------------------------------------------------------------------

describe('printBoard', () => {
  it('writes declarations in order, mines row-major, LF endings, trailing LF', () => {
    const board: Board = {
      id: 'demo-1',
      width: 3,
      height: 3,
      // Deliberately out of order to confirm the printer sorts row-major.
      mines: [[2, 2], [0, 1]],
      startTile: [2, 0],
    };
    const text = printBoard(board);
    expect(text).toBe(
      'version 1\n' +
        'id demo-1\n' +
        'width 3\n' +
        'height 3\n' +
        'mines 2\n' +
        'mine 0 1\n' +
        'mine 2 2\n' +
        'start 2 0\n',
    );
  });

  it('writes one revealed line per initial revealed tile, row-major', () => {
    const board: Board = {
      id: 'snippet',
      width: 2,
      height: 2,
      mines: [[0, 0]],
      initialRevealed: [[1, 1], [0, 1]],
    };
    const text = printBoard(board);
    expect(text).toBe(
      'version 1\n' +
        'id snippet\n' +
        'width 2\n' +
        'height 2\n' +
        'mines 1\n' +
        'mine 0 0\n' +
        'revealed 0 1\n' +
        'revealed 1 1\n',
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests: parsing valid input
// ---------------------------------------------------------------------------

describe('parseBoard - valid input', () => {
  it('parses a canonical board', () => {
    const board = parseBoard(
      'version 1\nid demo-1\nwidth 3\nheight 3\nmines 2\nmine 0 1\nmine 2 2\nstart 2 0\n',
    );
    expect(board.id).toBe('demo-1');
    expect(board.width).toBe(3);
    expect(board.height).toBe(3);
    expect(board.mines).toEqual([[0, 1], [2, 2]]);
    expect(board.startTile).toEqual([2, 0]);
  });

  it('accepts CRLF line endings and blank lines', () => {
    const text =
      'version 1\r\nid b\r\n\r\nwidth 2\r\nheight 1\r\nmines 1\r\nmine 0 0\r\n\r\nrevealed 0 1\r\n';
    const board = parseBoard(text);
    expect(board.id).toBe('b');
    expect(board.initialRevealed).toEqual([[0, 1]]);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: Requirement 3.2 rejections (rule + line number)
// ---------------------------------------------------------------------------

/** Parse and capture the BoardFormatError, failing if none is thrown. */
function expectError(text: string): BoardFormatError {
  try {
    parseBoard(text);
  } catch (e) {
    if (e instanceof BoardFormatError) return e;
    throw e;
  }
  throw new Error('expected a BoardFormatError but parsing succeeded');
}

describe('parseBoard - Requirement 3.2 rejections', () => {
  it('rejects an unsupported version with the line number', () => {
    const e = expectError('version 2\nid b\nwidth 2\nheight 2\nmines 0\nstart 0 0\n');
    expect(e.rule).toBe('unsupported_version');
    expect(e.line).toBe(1);
  });

  it('rejects width outside 1..30', () => {
    const e = expectError('version 1\nid b\nwidth 31\nheight 2\nmines 0\nstart 0 0\n');
    expect(e.rule).toBe('width_out_of_range');
    expect(e.line).toBe(3);
  });

  it('rejects height outside 1..30', () => {
    const e = expectError('version 1\nid b\nwidth 2\nheight 0\nmines 0\nstart 0 0\n');
    expect(e.rule).toBe('height_out_of_range');
    expect(e.line).toBe(4);
  });

  it('rejects a mine outside the board', () => {
    const e = expectError('version 1\nid b\nwidth 2\nheight 2\nmines 1\nmine 5 5\nstart 0 0\n');
    expect(e.rule).toBe('mine_out_of_bounds');
    expect(e.line).toBe(6);
  });

  it('rejects a duplicate mine', () => {
    const e = expectError(
      'version 1\nid b\nwidth 2\nheight 2\nmines 2\nmine 0 0\nmine 0 0\nstart 1 1\n',
    );
    expect(e.rule).toBe('duplicate_mine');
    expect(e.line).toBe(7);
  });

  it('rejects a declared mine count that differs from the listed mines', () => {
    const e = expectError('version 1\nid b\nwidth 2\nheight 2\nmines 3\nmine 0 0\nstart 1 1\n');
    expect(e.rule).toBe('mine_count_mismatch');
    expect(e.line).toBe(5);
  });

  it('rejects a start tile that is a mine', () => {
    const e = expectError('version 1\nid b\nwidth 2\nheight 2\nmines 1\nmine 0 0\nstart 0 0\n');
    expect(e.rule).toBe('start_is_mine');
    expect(e.line).toBe(7);
  });

  it('rejects a start tile that borders a mine', () => {
    const e = expectError('version 1\nid b\nwidth 2\nheight 2\nmines 1\nmine 0 0\nstart 0 1\n');
    expect(e.rule).toBe('start_borders_mine');
    expect(e.line).toBe(7);
  });

  it('rejects an initially revealed tile that is a mine', () => {
    const e = expectError(
      'version 1\nid b\nwidth 2\nheight 2\nmines 1\nmine 0 0\nrevealed 0 0\n',
    );
    expect(e.rule).toBe('revealed_is_mine');
    expect(e.line).toBe(7);
  });

  it('rejects a board with neither a start tile nor an initial revealed set', () => {
    const e = expectError('version 1\nid b\nwidth 2\nheight 2\nmines 1\nmine 0 0\n');
    expect(e.rule).toBe('missing_start_or_revealed');
  });
});

// ---------------------------------------------------------------------------
// Property tests (~100 runs each)
// ---------------------------------------------------------------------------

/**
 * Generate a valid Board: pick a size, place some mines, then pick a Start_Tile
 * that is not a mine and borders no mine. If no such tile exists, fall back to
 * an initial revealed set of all non-mine Tiles that are not mines.
 */
function validBoardArb(): fc.Arbitrary<Board> {
  return fc
    .record({
      width: fc.integer({ min: 2, max: 8 }),
      height: fc.integer({ min: 2, max: 8 }),
      id: fc
        .stringMatching(/^[A-Za-z0-9._-]{1,64}$/)
        .filter((s) => s.length >= 1 && s.length <= 64),
    })
    .chain(({ width, height, id }) => {
      const cells = width * height;
      return fc
        .uniqueArray(fc.integer({ min: 0, max: cells - 1 }), {
          minLength: 0,
          maxLength: Math.max(0, cells - 2),
        })
        .map((idxs) => {
          const mines: Tile[] = idxs.map((i) => [Math.floor(i / width), i % width]);
          const mineSet = new Set(mines.map(([r, c]) => tileKey(r, c)));

          // Find a start tile: not a mine, borders no mine.
          let startTile: Tile | undefined;
          for (let r = 0; r < height && !startTile; r++) {
            for (let c = 0; c < width && !startTile; c++) {
              if (mineSet.has(tileKey(r, c))) continue;
              if (numberAt([r, c], width, height, mineSet) === 0) startTile = [r, c];
            }
          }

          if (startTile) {
            return { id, width, height, mines, startTile } as Board;
          }

          // Otherwise ship an initial revealed set of every non-mine tile.
          const initialRevealed: Tile[] = [];
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              if (!mineSet.has(tileKey(r, c))) initialRevealed.push([r, c]);
            }
          }
          // There is always at least one non-mine tile (maxLength leaves >= 2 free).
          return { id, width, height, mines, initialRevealed } as Board;
        });
    });
}

/** Canonicalize a Board's tile lists to row-major for structural comparison. */
function canonical(board: Board): Board {
  const cmp = (a: Tile, b: Tile) => a[0] - b[0] || a[1] - b[1];
  const out: Board = {
    id: board.id,
    width: board.width,
    height: board.height,
    mines: [...board.mines].sort(cmp),
  };
  if (board.startTile) out.startTile = board.startTile;
  else if (board.initialRevealed) out.initialRevealed = [...board.initialRevealed].sort(cmp);
  return out;
}

describe('boardFormat - properties', () => {
  it('round-trips: print -> parse equals original and re-print is identical (Req 3.4)', () => {
    fc.assert(
      fc.property(validBoardArb(), (board) => {
        const text1 = printBoard(board);
        const parsed = parseBoard(text1);
        const text2 = printBoard(parsed);
        // Same text on re-print.
        expect(text2).toBe(text1);
        // Parsed board equals the original (compared canonically).
        expect(canonical(parsed)).toEqual(canonical(board));
      }),
      { numRuns: RUNS },
    );
  });

  it('accepted text re-prints to accepted text parsing to the same Board (Req 3.5)', () => {
    fc.assert(
      fc.property(validBoardArb(), (board) => {
        const text = printBoard(board);
        const parsedOnce = parseBoard(text);
        const reprinted = printBoard(parsedOnce);
        const parsedTwice = parseBoard(reprinted);
        expect(canonical(parsedTwice)).toEqual(canonical(parsedOnce));
      }),
      { numRuns: RUNS },
    );
  });
});

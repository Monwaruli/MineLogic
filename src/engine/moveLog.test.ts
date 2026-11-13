/**
 * Tests for the Move_Log_Format serializer and parser.
 *
 * Unit tests cover each rejection rule. Property tests cover the round-trip
 * invariants: serialize then parse returns an equal Move_Log, and parse then
 * serialize returns identical text.
 *
 * Validates: Requirements 9.5, 9.6, 9.7
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ActionType, MoveLogEntry } from './game';
import {
  MOVE_LOG_VERSION,
  MoveLogError,
  parseMoveLog,
  serializeMoveLog,
  type MoveLog,
} from './moveLog';

const RUNS = 100;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const BOUNDS = { width: 9, height: 9 };

const typeArb: fc.Arbitrary<ActionType> = fc.constantFrom(
  'Reveal_Click',
  'Flag_Toggle',
  'Chord_Click',
);

/** A legal board id (matches the Board_Format id pattern). */
const boardIdArb = fc
  .stringMatching(/^[A-Za-z0-9._-]{1,64}$/)
  .filter((s) => s.length >= 1 && s.length <= 64);

/** A Move_Log with non-decreasing timestamps and in-bounds tiles. */
function moveLogArb(): fc.Arbitrary<MoveLog> {
  const entryArb = fc.record({
    type: typeArb,
    row: fc.integer({ min: 0, max: BOUNDS.height - 1 }),
    col: fc.integer({ min: 0, max: BOUNDS.width - 1 }),
    gap: fc.integer({ min: 0, max: 5000 }),
    wasted: fc.boolean(),
  });
  return fc
    .record({
      boardId: boardIdArb,
      rows: fc.array(entryArb, { minLength: 0, maxLength: 30 }),
      hasEnd: fc.boolean(),
      endGap: fc.integer({ min: 0, max: 5000 }),
      outcome: fc.constantFrom('won', 'lost', 'timed_out', 'interrupted') as fc.Arbitrary<
        MoveLog extends { end?: infer E } ? (E extends { outcome: infer O } ? O : never) : never
      >,
    })
    .map(({ boardId, rows, hasEnd, endGap, outcome }) => {
      let t = 0;
      const entries: MoveLogEntry[] = rows.map((r) => {
        t += r.gap;
        // Chord-only wasted flag; keep it as given but it is always valid text.
        return {
          type: r.type,
          tile: [r.row, r.col] as [number, number],
          elapsedMs: t,
          wastedClick: r.wasted,
        };
      });
      const log: MoveLog = { boardId, entries };
      if (hasEnd) {
        log.end = { outcome, endMs: t + endGap };
      }
      return log;
    });
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('moveLog - round trip (Req 9.6)', () => {
  it('serialize then parse returns an equal Move_Log', () => {
    fc.assert(
      fc.property(moveLogArb(), (log) => {
        const parsed = parseMoveLog(serializeMoveLog(log), BOUNDS);
        expect(parsed).toEqual(log);
      }),
      { numRuns: RUNS },
    );
  });

  it('parse then serialize returns identical text', () => {
    fc.assert(
      fc.property(moveLogArb(), (log) => {
        const text = serializeMoveLog(log);
        const reText = serializeMoveLog(parseMoveLog(text, BOUNDS));
        expect(reText).toBe(text);
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests: happy path
// ---------------------------------------------------------------------------

describe('serializeMoveLog', () => {
  it('writes the version token, board id, moves, and the end entry', () => {
    const log: MoveLog = {
      boardId: 'b1',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false },
        { type: 'Flag_Toggle', tile: [1, 2], elapsedMs: 500, wastedClick: false },
        { type: 'Chord_Click', tile: [3, 4], elapsedMs: 900, wastedClick: true },
      ],
      end: { outcome: 'won', endMs: 1200 },
    };
    expect(serializeMoveLog(log)).toBe(
      `movelog ${MOVE_LOG_VERSION}\n` +
        'board b1\n' +
        'move reveal 0 0 0 0\n' +
        'move flag 1 2 500 0\n' +
        'move chord 3 4 900 1\n' +
        'end won 1200\n',
    );
  });

  it('omits the end line when there is no End_Entry', () => {
    const log: MoveLog = { boardId: 'b', entries: [] };
    expect(serializeMoveLog(log)).toBe(`movelog ${MOVE_LOG_VERSION}\nboard b\n`);
  });
});

describe('parseMoveLog - accepts', () => {
  it('accepts CRLF and blank lines', () => {
    const text = `movelog ${MOVE_LOG_VERSION}\r\n\r\nboard b1\r\nmove reveal 0 0 0 0\r\n\r\nend lost 10\r\n`;
    const log = parseMoveLog(text, BOUNDS);
    expect(log.boardId).toBe('b1');
    expect(log.entries).toHaveLength(1);
    expect(log.end).toEqual({ outcome: 'lost', endMs: 10 });
  });
});

// ---------------------------------------------------------------------------
// Unit tests: rejection rules (Req 9.7)
// ---------------------------------------------------------------------------

/** Run `parse` and return the thrown MoveLogError (fails if none is thrown). */
function expectError(text: string, bounds?: { width: number; height: number }): MoveLogError {
  try {
    parseMoveLog(text, bounds);
  } catch (e) {
    if (e instanceof MoveLogError) return e;
    throw e;
  }
  throw new Error('expected parseMoveLog to throw');
}

describe('parseMoveLog - rejects', () => {
  it('rejects an unknown action type and names the entry index', () => {
    const text = `movelog 1\nboard b\nmove reveal 0 0 0 0\nmove teleport 1 1 10 0\n`;
    const err = expectError(text, BOUNDS);
    expect(err.rule).toBe('unknown_action_type');
    expect(err.entryIndex).toBe(1);
  });

  it('rejects a tile outside the board', () => {
    const text = `movelog 1\nboard b\nmove reveal 0 0 0 0\nmove reveal 99 0 10 0\n`;
    const err = expectError(text, BOUNDS);
    expect(err.rule).toBe('tile_out_of_bounds');
    expect(err.entryIndex).toBe(1);
  });

  it('rejects a decreasing timestamp', () => {
    const text = `movelog 1\nboard b\nmove reveal 0 0 100 0\nmove reveal 1 1 50 0\n`;
    const err = expectError(text, BOUNDS);
    expect(err.rule).toBe('decreasing_timestamp');
    expect(err.entryIndex).toBe(1);
  });

  it('rejects a missing board id', () => {
    const text = `movelog 1\nmove reveal 0 0 0 0\n`;
    const err = expectError(text, BOUNDS);
    expect(err.rule).toBe('missing_board_id');
    expect(err.entryIndex).toBe(-1);
  });

  it('rejects an unsupported version', () => {
    const err = expectError(`movelog 99\nboard b\n`, BOUNDS);
    expect(err.rule).toBe('unsupported_version');
  });

  it('rejects an invalid outcome in the end entry', () => {
    const text = `movelog 1\nboard b\nmove reveal 0 0 0 0\nend draw 10\n`;
    const err = expectError(text, BOUNDS);
    expect(err.rule).toBe('invalid_outcome');
  });
});

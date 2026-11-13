/**
 * Move_Log_Format: versioned text that serializes a game's Move_Log so it can
 * be stored, parsed back, and replayed. It is the stored record that the
 * Metrics_Engine recomputes from, so assessment and evaluation use the same
 * bytes (Requirement 9).
 *
 * Pure: no React or DOM imports, deterministic. The serializer and parser are
 * exact inverses (round-trip property), and the parser rejects malformed text
 * with a clear error naming the failed rule and the offending entry index.
 *
 * Grammar, one declaration per line, LF line endings, blank lines allowed on
 * parse:
 *
 *     movelog 1                 (format version token)
 *     board <id>                (the Board identifier the log was played on)
 *     move <type> <row> <col> <elapsedMs> <wasted>
 *     ...
 *     end <outcome> <endMs>     (the End_Entry; optional)
 *
 * where
 *   <type>     is reveal | flag | chord
 *   <wasted>   is 0 or 1 (1 marks a Chord_Click that changed nothing)
 *   <outcome>  is won | lost | timed_out | interrupted
 *
 * See the Design Notes in tasks.md and Requirements 8 and 9.
 */

import type { ActionType, MoveLogEntry } from './game';
import type { Tile } from './board';

/** The Move_Log_Format version this module reads and writes. */
export const MOVE_LOG_VERSION = 1;

/** How a game ended, recorded in the End_Entry. */
export type GameOutcome = 'won' | 'lost' | 'timed_out' | 'interrupted';

/** The End_Entry: the game's outcome and the end time in elapsed ms. */
export interface EndEntry {
  outcome: GameOutcome;
  /** Milliseconds since the Start_Tile reveal at which the game ended. */
  endMs: number;
}

/**
 * A full Move_Log: the Board identifier it was played on, the ordered entries
 * (one per applied Player_Action, exactly the shape the Board_Engine produces),
 * and an optional End_Entry.
 */
export interface MoveLog {
  boardId: string;
  entries: MoveLogEntry[];
  end?: EndEntry;
}

/**
 * A Move_Log parse failure. `rule` names the violated rule; `entryIndex` is the
 * zero-based index of the offending `move` entry, or -1 when the problem
 * concerns the log as a whole (e.g. a missing board id).
 */
export class MoveLogError extends Error {
  readonly rule: string;
  readonly entryIndex: number;

  constructor(rule: string, entryIndex: number, detail: string) {
    super(`entry ${entryIndex}: ${rule} - ${detail}`);
    this.name = 'MoveLogError';
    this.rule = rule;
    this.entryIndex = entryIndex;
  }
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/** Wire token for each ActionType. */
const TYPE_TO_TOKEN: Record<ActionType, string> = {
  Reveal_Click: 'reveal',
  Flag_Toggle: 'flag',
  Chord_Click: 'chord',
};

/** Inverse of {@link TYPE_TO_TOKEN}. */
const TOKEN_TO_TYPE: Record<string, ActionType> = {
  reveal: 'Reveal_Click',
  flag: 'Flag_Toggle',
  chord: 'Chord_Click',
};

const OUTCOMES: readonly GameOutcome[] = ['won', 'lost', 'timed_out', 'interrupted'];

/**
 * Serialize a Move_Log to canonical Move_Log_Format text.
 *
 * Declarations are written in the fixed order above, lines are joined with LF,
 * and the text ends with a trailing LF.
 */
export function serializeMoveLog(log: MoveLog): string {
  const lines: string[] = [];
  lines.push(`movelog ${MOVE_LOG_VERSION}`);
  lines.push(`board ${log.boardId}`);
  for (const e of log.entries) {
    const token = TYPE_TO_TOKEN[e.type];
    const wasted = e.wastedClick ? 1 : 0;
    lines.push(`move ${token} ${e.tile[0]} ${e.tile[1]} ${e.elapsedMs} ${wasted}`);
  }
  if (log.end) {
    lines.push(`end ${log.end.outcome} ${log.end.endMs}`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/** A line paired with its 1-based number, after blank lines are dropped. */
interface NumberedLine {
  text: string;
  line: number;
}

/** Parse a non-negative integer token, failing with a named rule. */
function parseInt10(
  token: string,
  rule: string,
  entryIndex: number,
  detail: string,
): number {
  if (!/^-?\d+$/.test(token)) throw new MoveLogError(rule, entryIndex, detail);
  return Number.parseInt(token, 10);
}

/**
 * Parse Move_Log_Format text into a Move_Log.
 *
 * `bounds`, when given, enables the Tile-in-bounds check (Requirement 9.7): a
 * move whose Tile lies outside the Board is rejected. Timestamps must never
 * decrease, the board id must be present, and every action type must be known.
 *
 * Accepts CRLF and blank lines. Throws {@link MoveLogError} naming the failed
 * rule and the offending entry index.
 */
export function parseMoveLog(
  text: string,
  bounds?: { width: number; height: number },
): MoveLog {
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: NumberedLine[] = [];
  rawLines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed.length > 0) lines.push({ text: trimmed, line: i + 1 });
  });

  let cursor = 0;
  const peek = (): NumberedLine | undefined => lines[cursor];
  const next = (): NumberedLine | undefined => lines[cursor++];

  // ---- version ----
  const versionLine = next();
  if (!versionLine) throw new MoveLogError('missing_version', -1, 'empty move log text');
  const versionParts = versionLine.text.split(/\s+/);
  if (versionParts[0] !== 'movelog') {
    throw new MoveLogError('missing_version', -1, 'expected "movelog" declaration');
  }
  const version = parseInt10(versionParts[1] ?? '', 'unsupported_version', -1, 'version is not an integer');
  if (version !== MOVE_LOG_VERSION) {
    throw new MoveLogError('unsupported_version', -1, `unsupported version ${version}`);
  }

  // ---- board id ----
  const boardLine = next();
  if (!boardLine || boardLine.text.split(/\s+/)[0] !== 'board') {
    throw new MoveLogError('missing_board_id', -1, 'expected "board" declaration');
  }
  const boardId = boardLine.text.slice('board'.length).trim();
  if (boardId.length === 0) {
    throw new MoveLogError('missing_board_id', -1, 'board id is empty');
  }

  // ---- move entries ----
  const entries: MoveLogEntry[] = [];
  let prevElapsed = 0;
  while (peek() && peek()!.text.split(/\s+/)[0] === 'move') {
    const entryIndex = entries.length;
    const parts = next()!.text.split(/\s+/);
    // move <type> <row> <col> <elapsedMs> <wasted>
    const typeToken = parts[1] ?? '';
    const type = TOKEN_TO_TYPE[typeToken];
    if (type === undefined) {
      throw new MoveLogError('unknown_action_type', entryIndex, `unknown action type "${typeToken}"`);
    }
    const row = parseInt10(parts[2] ?? '', 'malformed_move', entryIndex, 'row is not an integer');
    const col = parseInt10(parts[3] ?? '', 'malformed_move', entryIndex, 'col is not an integer');
    const elapsedMs = parseInt10(parts[4] ?? '', 'malformed_move', entryIndex, 'elapsedMs is not an integer');
    const wastedToken = parts[5] ?? '';
    if (wastedToken !== '0' && wastedToken !== '1') {
      throw new MoveLogError('malformed_move', entryIndex, `wasted flag "${wastedToken}" is not 0 or 1`);
    }

    if (bounds && (row < 0 || row >= bounds.height || col < 0 || col >= bounds.width)) {
      throw new MoveLogError('tile_out_of_bounds', entryIndex, `tile (${row},${col}) is outside the board`);
    }
    if (elapsedMs < 0) {
      throw new MoveLogError('decreasing_timestamp', entryIndex, `elapsedMs ${elapsedMs} is negative`);
    }
    if (elapsedMs < prevElapsed) {
      throw new MoveLogError(
        'decreasing_timestamp',
        entryIndex,
        `elapsedMs ${elapsedMs} is less than the previous ${prevElapsed}`,
      );
    }
    prevElapsed = elapsedMs;

    const tile: Tile = [row, col];
    entries.push({ type, tile, elapsedMs, wastedClick: wastedToken === '1' });
  }

  // ---- optional end entry ----
  let end: EndEntry | undefined;
  if (peek() && peek()!.text.split(/\s+/)[0] === 'end') {
    const parts = next()!.text.split(/\s+/);
    const outcome = parts[1] as GameOutcome;
    if (!OUTCOMES.includes(outcome)) {
      throw new MoveLogError('invalid_outcome', entries.length, `unknown outcome "${parts[1]}"`);
    }
    const endMs = parseInt10(parts[2] ?? '', 'malformed_end', entries.length, 'endMs is not an integer');
    if (endMs < prevElapsed) {
      throw new MoveLogError(
        'decreasing_timestamp',
        entries.length,
        `end time ${endMs} is before the last move ${prevElapsed}`,
      );
    }
    end = { outcome, endMs };
  }

  // ---- trailing content ----
  const leftover = peek();
  if (leftover) {
    throw new MoveLogError('unexpected_line', entries.length, `unexpected "${leftover.text}"`);
  }

  const log: MoveLog = { boardId, entries };
  if (end) log.end = end;
  return log;
}

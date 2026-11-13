/**
 * Board_Format text: one declaration per line, shared by TypeScript and Python.
 *
 *     version 1
 *     id <1-64 chars: letters, digits, period, underscore, hyphen>
 *     width <1-30>
 *     height <1-30>
 *     mines <count>
 *     mine <row> <col>       (one line per mine)
 *     start <row> <col>      (or one or more lines of: revealed <row> <col>)
 *
 * The Board_Printer writes the declarations in the order above, Tile
 * coordinates in row-major order, and LF line endings. The Board_Parser accepts
 * CRLF and blank lines, and rejects the Requirement 3.2 cases with the failed
 * rule and the line number where the problem was found.
 *
 * See the Design Notes in tasks.md and Requirement 3.
 */

import {
  neighbors,
  numberAt,
  tileKey,
  type Board,
  type Tile,
} from './board';

/** The Board_Format version this module reads and writes. */
export const BOARD_FORMAT_VERSION = 1;

/** Legal id: 1-64 chars of letters, digits, period, underscore, hyphen. */
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * A parse failure. `rule` names the violated rule; `line` is the 1-based line
 * number in the original text where the problem was found (0 when it concerns
 * the text as a whole, such as a missing required declaration).
 */
export class BoardFormatError extends Error {
  readonly rule: string;
  readonly line: number;

  constructor(rule: string, line: number, detail: string) {
    super(`line ${line}: ${rule} - ${detail}`);
    this.name = 'BoardFormatError';
    this.rule = rule;
    this.line = line;
  }
}

/** Compare two Tiles in row-major order. */
function compareTiles(a: Tile, b: Tile): number {
  return a[0] - b[0] || a[1] - b[1];
}

/**
 * Print a Board as canonical Board_Format text.
 *
 * Declarations are written in the fixed order; mines are listed in row-major
 * order; a Board with a `startTile` emits a single `start` line, and a Board
 * with `initialRevealed` emits one `revealed` line per Tile in row-major order.
 * Lines are joined with LF and the text ends with a trailing LF.
 */
export function printBoard(board: Board): string {
  const lines: string[] = [];
  lines.push(`version ${BOARD_FORMAT_VERSION}`);
  lines.push(`id ${board.id}`);
  lines.push(`width ${board.width}`);
  lines.push(`height ${board.height}`);
  lines.push(`mines ${board.mines.length}`);

  const mines = [...board.mines].sort(compareTiles);
  for (const [r, c] of mines) lines.push(`mine ${r} ${c}`);

  if (board.startTile) {
    lines.push(`start ${board.startTile[0]} ${board.startTile[1]}`);
  } else if (board.initialRevealed) {
    const revealed = [...board.initialRevealed].sort(compareTiles);
    for (const [r, c] of revealed) lines.push(`revealed ${r} ${c}`);
  }

  return lines.join('\n') + '\n';
}

/** A line paired with its 1-based number, after blank lines are dropped. */
interface NumberedLine {
  text: string;
  line: number;
}

/** Parse an integer token, failing with a named rule on bad input. */
function parseInt10(token: string, rule: string, line: number, detail: string): number {
  if (!/^-?\d+$/.test(token)) throw new BoardFormatError(rule, line, detail);
  return Number.parseInt(token, 10);
}

/**
 * Parse Board_Format text into a Board.
 *
 * Accepts CRLF and blank lines. Throws {@link BoardFormatError} naming the
 * failed rule and the line number for every case in Requirement 3.2.
 */
export function parseBoard(text: string): Board {
  // Normalize CRLF to LF, then keep track of original 1-based line numbers so
  // errors point at the right place even with blank lines removed.
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
  if (!versionLine) throw new BoardFormatError('missing_version', 0, 'empty board text');
  const versionParts = versionLine.text.split(/\s+/);
  if (versionParts[0] !== 'version') {
    throw new BoardFormatError('missing_version', versionLine.line, 'expected "version" declaration');
  }
  const version = parseInt10(
    versionParts[1] ?? '',
    'unsupported_version',
    versionLine.line,
    'version is not an integer',
  );
  if (version !== BOARD_FORMAT_VERSION) {
    throw new BoardFormatError(
      'unsupported_version',
      versionLine.line,
      `unsupported version ${version}`,
    );
  }

  // ---- id ----
  const idLine = next();
  if (!idLine || idLine.text.split(/\s+/)[0] !== 'id') {
    throw new BoardFormatError('missing_id', idLine?.line ?? 0, 'expected "id" declaration');
  }
  const id = idLine.text.slice('id'.length).trim();
  if (!ID_PATTERN.test(id)) {
    throw new BoardFormatError('invalid_id', idLine.line, `id "${id}" is not 1-64 legal characters`);
  }

  // ---- width ----
  const widthLine = next();
  if (!widthLine || widthLine.text.split(/\s+/)[0] !== 'width') {
    throw new BoardFormatError('missing_width', widthLine?.line ?? 0, 'expected "width" declaration');
  }
  const width = parseInt10(
    widthLine.text.split(/\s+/)[1] ?? '',
    'width_out_of_range',
    widthLine.line,
    'width is not an integer',
  );
  if (width < 1 || width > 30) {
    throw new BoardFormatError('width_out_of_range', widthLine.line, `width ${width} is not in 1..30`);
  }

  // ---- height ----
  const heightLine = next();
  if (!heightLine || heightLine.text.split(/\s+/)[0] !== 'height') {
    throw new BoardFormatError('missing_height', heightLine?.line ?? 0, 'expected "height" declaration');
  }
  const height = parseInt10(
    heightLine.text.split(/\s+/)[1] ?? '',
    'height_out_of_range',
    heightLine.line,
    'height is not an integer',
  );
  if (height < 1 || height > 30) {
    throw new BoardFormatError('height_out_of_range', heightLine.line, `height ${height} is not in 1..30`);
  }

  // ---- mines <count> ----
  const minesLine = next();
  if (!minesLine || minesLine.text.split(/\s+/)[0] !== 'mines') {
    throw new BoardFormatError('missing_mines', minesLine?.line ?? 0, 'expected "mines" declaration');
  }
  const declaredMineCount = parseInt10(
    minesLine.text.split(/\s+/)[1] ?? '',
    'mine_count_mismatch',
    minesLine.line,
    'mine count is not an integer',
  );

  // ---- mine lines ----
  const mines: Tile[] = [];
  const mineSet = new Set<string>();
  while (peek() && peek()!.text.split(/\s+/)[0] === 'mine') {
    const ml = next()!;
    const parts = ml.text.split(/\s+/);
    const r = parseInt10(parts[1] ?? '', 'mine_out_of_bounds', ml.line, 'mine row is not an integer');
    const c = parseInt10(parts[2] ?? '', 'mine_out_of_bounds', ml.line, 'mine col is not an integer');
    if (r < 0 || r >= height || c < 0 || c >= width) {
      throw new BoardFormatError('mine_out_of_bounds', ml.line, `mine (${r},${c}) is outside the board`);
    }
    const key = tileKey(r, c);
    if (mineSet.has(key)) {
      throw new BoardFormatError('duplicate_mine', ml.line, `mine (${r},${c}) is listed twice`);
    }
    mineSet.add(key);
    mines.push([r, c]);
  }

  if (mines.length !== declaredMineCount) {
    throw new BoardFormatError(
      'mine_count_mismatch',
      minesLine.line,
      `declared ${declaredMineCount} mines but listed ${mines.length}`,
    );
  }

  // ---- start / revealed ----
  let startTile: Tile | undefined;
  const initialRevealed: Tile[] = [];

  const startish = peek();
  if (startish && startish.text.split(/\s+/)[0] === 'start') {
    const sl = next()!;
    const parts = sl.text.split(/\s+/);
    const r = parseInt10(parts[1] ?? '', 'start_invalid', sl.line, 'start row is not an integer');
    const c = parseInt10(parts[2] ?? '', 'start_invalid', sl.line, 'start col is not an integer');
    if (r < 0 || r >= height || c < 0 || c >= width) {
      throw new BoardFormatError('start_invalid', sl.line, `start (${r},${c}) is outside the board`);
    }
    if (mineSet.has(tileKey(r, c))) {
      throw new BoardFormatError('start_is_mine', sl.line, `start (${r},${c}) is a mine`);
    }
    if (numberAt([r, c], width, height, mineSet) > 0) {
      throw new BoardFormatError('start_borders_mine', sl.line, `start (${r},${c}) borders a mine`);
    }
    startTile = [r, c];
  } else {
    const revealedSet = new Set<string>();
    while (peek() && peek()!.text.split(/\s+/)[0] === 'revealed') {
      const rl = next()!;
      const parts = rl.text.split(/\s+/);
      const r = parseInt10(parts[1] ?? '', 'revealed_invalid', rl.line, 'revealed row is not an integer');
      const c = parseInt10(parts[2] ?? '', 'revealed_invalid', rl.line, 'revealed col is not an integer');
      if (r < 0 || r >= height || c < 0 || c >= width) {
        throw new BoardFormatError('revealed_invalid', rl.line, `revealed (${r},${c}) is outside the board`);
      }
      if (mineSet.has(tileKey(r, c))) {
        throw new BoardFormatError('revealed_is_mine', rl.line, `revealed (${r},${c}) is a mine`);
      }
      const key = tileKey(r, c);
      if (!revealedSet.has(key)) {
        revealedSet.add(key);
        initialRevealed.push([r, c]);
      }
    }
  }

  // ---- trailing content ----
  const leftover = peek();
  if (leftover) {
    throw new BoardFormatError('unexpected_line', leftover.line, `unexpected "${leftover.text}"`);
  }

  // ---- must have a start or an initial revealed set ----
  if (!startTile && initialRevealed.length === 0) {
    throw new BoardFormatError(
      'missing_start_or_revealed',
      0,
      'board has neither a start tile nor an initial revealed set',
    );
  }

  const board: Board = { id, width, height, mines };
  if (startTile) board.startTile = startTile;
  else board.initialRevealed = initialRevealed;
  return board;
}

/** Re-export used by tests that build neighbor/number expectations. */
export { neighbors };

/**
 * Core board types and geometry helpers shared across the engine.
 *
 * This is the minimal version needed by the Solver. Task 1 extends it with the
 * full Board_Engine (actions, cascades, move log, etc.). Keep names plain so the
 * later work can build on them without renaming.
 *
 * Tiles are `[row, col]`, zero-based. Row-major order sorts by row, then column.
 * Width is the number of columns.
 */

/** A zero-based tile coordinate: `[row, col]`. */
export type Tile = [number, number];

/**
 * A fixed board layout.
 *
 * A full board has a `startTile` (a tile with no adjacent mines that must be
 * revealed first). Mini_Boards and Skill_Check_Snippets instead ship with an
 * `initialRevealed` set. Exactly one of the two is present.
 */
export interface Board {
  /** Identifier: 1-64 chars of letters, digits, period, underscore, hyphen. */
  id: string;
  /** Number of columns. */
  width: number;
  /** Number of rows. */
  height: number;
  /** The mine positions, row-major by convention. */
  mines: Tile[];
  /** Full boards: the guaranteed-safe first tile. */
  startTile?: Tile;
  /** Mini_Boards / snippets: the tiles revealed from the start. */
  initialRevealed?: Tile[];
}

/** One difficulty preset. */
export interface Difficulty {
  name: string;
  width: number;
  height: number;
  mines: number;
}

/** The three standard difficulty presets. */
export const DIFFICULTIES = {
  Beginner: { name: 'Beginner', width: 9, height: 9, mines: 10 },
  Intermediate: { name: 'Intermediate', width: 16, height: 16, mines: 40 },
  Expert: { name: 'Expert', width: 30, height: 16, mines: 99 },
} as const satisfies Record<string, Difficulty>;

/** True when `[row, col]` lies inside a `width` x `height` grid. */
export function inBounds(row: number, col: number, width: number, height: number): boolean {
  return row >= 0 && row < height && col >= 0 && col < width;
}

/**
 * The 8-connected neighbors of `tile` that lie inside the grid, in row-major
 * order. The tile itself is never included.
 */
export function neighbors(tile: Tile, width: number, height: number): Tile[] {
  const [row, col] = tile;
  const result: Tile[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (inBounds(r, c, width, height)) result.push([r, c]);
    }
  }
  return result;
}

/**
 * The Number of a tile: the count of mines among its 8-connected neighbors.
 * `mineSet` holds `"row,col"` keys for the board's mines.
 */
export function numberAt(tile: Tile, width: number, height: number, mineSet: Set<string>): number {
  let count = 0;
  for (const [r, c] of neighbors(tile, width, height)) {
    if (mineSet.has(`${r},${c}`)) count++;
  }
  return count;
}

/** Row-major string key for a tile, for use in sets and maps. */
export function tileKey(row: number, col: number): string {
  return `${row},${col}`;
}

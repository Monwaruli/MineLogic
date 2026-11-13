/**
 * 3BV (Bechtel's Board Benchmark Value): the minimum number of left-click
 * reveals needed to clear a Board without using flags or chords.
 *
 * It is the number of Openings (connected regions of zero-Number Tiles, where
 * one click on any Tile of an Opening reveals the whole region and its border)
 * plus the number of non-mine Tiles that are not themselves zero and do not
 * border any zero-Number Tile (each such Tile needs its own click).
 *
 * Pure: no React or DOM imports. See the task text and Requirement 5.5.
 */

import { neighbors, numberAt, tileKey, type Board, type Tile } from './board';

/**
 * Compute the 3BV of a Board.
 *
 * Openings are found by flooding 8-connected regions of zero-Number Tiles.
 * Every non-zero, non-mine Tile that touches an Opening is covered by clicking
 * that Opening, so it is not counted separately. Every remaining non-mine,
 * non-zero Tile that touches no Opening needs its own click.
 */
export function threeBV(board: Board): number {
  const { width, height } = board;
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));

  const numberOf = (tile: Tile): number => numberAt(tile, width, height, mineSet);
  const isMine = (r: number, c: number): boolean => mineSet.has(tileKey(r, c));

  // Flood every Opening (region of zero-Number Tiles) and mark which Tiles are
  // "covered" by clicking some Opening: the zero Tiles themselves and every
  // Tile that borders a zero Tile.
  const coveredByOpening = new Set<string>();
  const visitedZero = new Set<string>();
  let openings = 0;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const key = tileKey(r, c);
      if (isMine(r, c)) continue;
      if (visitedZero.has(key)) continue;
      if (numberOf([r, c]) !== 0) continue;

      // New Opening: flood it 8-connected over zero Tiles.
      openings++;
      const stack: Tile[] = [[r, c]];
      while (stack.length > 0) {
        const tile = stack.pop()!;
        const tkey = tileKey(tile[0], tile[1]);
        if (visitedZero.has(tkey)) continue;
        visitedZero.add(tkey);
        coveredByOpening.add(tkey);
        for (const nb of neighbors(tile, width, height)) {
          const nk = tileKey(nb[0], nb[1]);
          // Every neighbor of a zero Tile is revealed by the Opening's click.
          if (!isMine(nb[0], nb[1])) coveredByOpening.add(nk);
          // Keep flooding only through further zero Tiles.
          if (!visitedZero.has(nk) && numberOf(nb) === 0 && !isMine(nb[0], nb[1])) {
            stack.push(nb);
          }
        }
      }
    }
  }

  // Each non-mine Tile not covered by any Opening needs its own click.
  let isolatedClicks = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (isMine(r, c)) continue;
      if (!coveredByOpening.has(tileKey(r, c))) isolatedClicks++;
    }
  }

  return openings + isolatedClicks;
}

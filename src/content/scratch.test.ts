import { describe, it } from 'vitest';
import { classify, type BoardState } from '../engine/solver';
import { numberAt, neighbors, tileKey, type Tile } from '../engine/board';

/**
 * Scratch harness to design Mini_Boards. Prints the classification of candidate
 * 5x5 boards so I can pick targets that are Provably_Safe and mines that are
 * Provably_Mine. Deleted before completion.
 */

function analyze(name: string, mines: Tile[], revealed: Tile[]): void {
  const width = 5;
  const height = 5;
  const mineSet = new Set(mines.map(([r, c]) => tileKey(r, c)));
  const revList = revealed.map((t) => ({
    tile: t,
    number: numberAt(t, width, height, mineSet),
  }));
  const state: BoardState = { width, height, mineCount: mines.length, revealed: revList };
  const res = classify(state);
  const grid: string[][] = [];
  const revSet = new Set(revealed.map(([r, c]) => tileKey(r, c)));
  for (let r = 0; r < height; r++) {
    const row: string[] = [];
    for (let c = 0; c < width; c++) {
      const key = tileKey(r, c);
      if (revSet.has(key)) {
        row.push(String(numberAt([r, c], width, height, mineSet)));
      } else if (mineSet.has(key)) {
        const cls = res.classification.get(key);
        row.push(cls === 'Provably_Mine' ? 'M' : cls === 'Provably_Safe' ? '!' : 'x');
      } else {
        const cls = res.classification.get(key);
        row.push(cls === 'Provably_Safe' ? 'S' : cls === 'Provably_Mine' ? 'm' : '?');
      }
    }
    grid.push(row);
  }
  // eslint-disable-next-line no-console
  console.log(
    `\n=== ${name} === inexact=${res.inexact} inconsistent=${res.inconsistent}\n` +
      grid.map((r) => r.join(' ')).join('\n'),
  );
}

describe('scratch', () => {
  it('prints candidates', () => {
    void neighbors;
    // Exposed_Mines: corner 1 with a single covered neighbor (the mine), rest safe.
    analyze('exposed-1', [[0, 0]], [[0, 1], [1, 0], [1, 1], [1, 2]]);

    // Satisfied_Number: need the mine Provably_Mine so the 1 is satisfied by it.
    // Reveal numbers that corner the mine into one cell.
    analyze('satisfied-corner', [[0, 0]], [[0, 1], [0, 2], [1, 0], [1, 1], [2, 0]]);

    // Wall 1-1
    analyze('wall-1-1', [[0, 0]], [[0, 1], [1, 0], [1, 1], [1, 2]]);

    // Wall 1-2-1
    analyze('wall-1-2-1', [[0, 1], [0, 3]], [[1, 1], [1, 2], [1, 3]]);

    // Wall 1-2-2-1
    analyze('wall-1-2-2-1', [[0, 0], [0, 3]], [[1, 0], [1, 1], [1, 2], [1, 3]]);

    // Subset
    analyze('subset', [[0, 1], [2, 2]], [[1, 1], [1, 2], [2, 1]]);

    // Clue chain
    analyze('clue-chain', [[0, 0], [0, 2], [2, 1]], [[1, 0], [1, 1], [1, 2]]);

    // Mine count endgame
    analyze('mine-count', [[0, 4]], [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [1, 3], [1, 4]]);
  });
});

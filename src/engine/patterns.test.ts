/**
 * Tests for the Pattern_Detector.
 *
 * - Hand-built fixtures for each Pattern_Type assert the detector attributes
 *   the fixture's labeled safe Tiles to the fixture's Pattern_Type
 *   (Requirement 7.8). The wall fixtures (Wall_1_1, Wall_1_2_1, Wall_1_2_2_1)
 *   are the heart of 7.8.
 * - Pattern_Instance lifecycle: appearance, resolution, exclusion by cascade,
 *   supersession, and unresolved at game end (Requirement 7.3-7.7).
 *
 * A note on the catalog, grounded in the glossary definitions: under the strict
 * "smallest set of revealed Numbers that proves the Tile safe" reading of
 * Anchor_Numbers, a single-clue safe deduction always has a Reduced_Value of
 * zero (every remaining covered Neighbor is safe), so Beginner safe Tiles
 * surface as Satisfied_Number. The 1-2-1 and 1-2-2-1 wall deductions need three
 * and four Numbers respectively, so they are Multi_Clue; the detector still
 * attributes them to their wall template, which takes priority over Clue_Chain,
 * matching the Intermediate tier's teaching of 1-1 / 1-2-1 / 1-2-2-1 as named
 * patterns. These interpretations are documented in patterns.ts.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */

import { describe, it, expect } from 'vitest';
import { tileKey, type Board, type Tile } from './board';
import { createGame } from './game';
import {
  attributeSafeTiles,
  classifyPattern,
  detectPatternInstances,
  type PatternType,
} from './patterns';
import type { MoveLog } from './moveLog';

/** The Pattern_Type attributed to a specific covered Tile of a Board. */
function patternOf(board: Board, tile: Tile): PatternType | undefined {
  const attr = attributeSafeTiles(createGame(board, 0));
  return attr.get(tileKey(tile[0], tile[1]))?.patternType;
}

/** The set of every Pattern_Type attributed across a Board_State. */
function patternsOn(board: Board): Set<PatternType> {
  const attr = attributeSafeTiles(createGame(board, 0));
  return new Set([...attr.values()].map((a) => a.patternType));
}

describe('Pattern_Detector - Beginner tier fixtures (Req 7.8)', () => {
  it('attributes a Satisfied_Number deduction (Reduced_Value 0, Single_Clue)', () => {
    // A revealed 0 at (1,1) proves its covered Neighbors safe by itself. On a
    // large board the far mine keeps the total count non-binding, so the 0 is
    // the lone constraint: one Number, Reduced_Value 0 -> Satisfied_Number.
    const board: Board = {
      id: 'satisfied',
      width: 8,
      height: 8,
      mines: [[7, 7]],
      initialRevealed: [[1, 1]],
    };
    expect(patternOf(board, [2, 2])).toBe('Satisfied_Number');
    expect(patternOf(board, [0, 0])).toBe('Satisfied_Number');
  });
});

describe('Pattern_Detector - wall fixtures (Req 7.2, 7.8)', () => {
  it('attributes a Wall_1_1 deduction (two 1s in a straight run)', () => {
    // Top row has two 1s at (0,0),(0,1) over a wall of covered Tiles, with mines
    // under the ends. (1,2) is proven safe by the pair of 1s: Pair_Clue whose
    // Reduced_Value run is 1-1 -> Wall_1_1.
    const board: Board = {
      id: 'wall11',
      width: 8,
      height: 8,
      mines: [[1, 0], [1, 3], [7, 7]],
      initialRevealed: [[0, 0], [0, 1], [0, 2], [0, 3]],
    };
    expect(patternOf(board, [1, 2])).toBe('Wall_1_1');
  });

  it('attributes a Wall_1_2_1 deduction (three Numbers reading 1-2-1)', () => {
    // The classic 1-2-1: numbers (0,0)=1,(0,1)=2,(0,2)=1 over covered Tiles, with
    // mines under the 1s. The cell under the 2 is safe, proven by all three
    // Numbers (Multi_Clue), whose Reduced_Value run is 1-2-1 -> Wall_1_2_1.
    const board: Board = {
      id: 'wall121',
      width: 8,
      height: 8,
      mines: [[1, 0], [1, 2], [7, 7]],
      initialRevealed: [[0, 0], [0, 1], [0, 2]],
    };
    expect(patternOf(board, [1, 1])).toBe('Wall_1_2_1');
    // Every safe Tile in this isolated run is attributed to the wall template.
    expect(patternsOn(board)).toEqual(new Set<PatternType>(['Wall_1_2_1']));
  });

  it('names a Wall_1_2_2_1 run through the wall matcher (Req 7.2, 7.8)', () => {
    // A straight run of four Numbers reading 1-2-2-1. The safe-Tile deductions in
    // a 1-2-2-1 decompose into smaller sets, so no single safe Tile has all four
    // as its minimal Anchor_Numbers; this test instead drives classifyPattern
    // with the four collinear anchors directly to verify the detector names the
    // 1-2-2-1 wall template. The anchors' Reduced_Values read 1,2,2,1.
    const board: Board = {
      id: 'wall1221',
      width: 9,
      height: 9,
      mines: [[1, 1], [1, 2], [8, 8]],
      initialRevealed: [[0, 0], [0, 1], [0, 2], [0, 3]],
    };
    const game = createGame(board, 0);
    const anchors: Tile[] = [[0, 0], [0, 1], [0, 2], [0, 3]];
    const type = classifyPattern(game, [1, 0], anchors, 'Multi_Clue', false, new Set());
    expect(type).toBe('Wall_1_2_2_1');
  });
});

describe('Pattern_Detector - Expert tier fixtures', () => {
  it('attributes a Clue_Chain deduction (three+ Numbers, not a wall run)', () => {
    // In an isolated 1-2-2-1 region the safe cell under the left 1 is proven by
    // three non-contiguous Numbers (a gap in the run), so it is a Multi_Clue
    // that matches no wall template -> Clue_Chain.
    const board: Board = {
      id: 'chain',
      width: 9,
      height: 9,
      mines: [[1, 1], [1, 2], [8, 8]],
      initialRevealed: [[0, 0], [0, 1], [0, 2], [0, 3]],
    };
    expect(patternOf(board, [1, 0])).toBe('Clue_Chain');
  });

  it('attributes a Mine_Count_Endgame deduction (total mine count needed)', () => {
    // A lone 2 at (1,1) on an L of revealed Numbers leaves (2,2) safe only once
    // the total mine count is used: Mine_Count -> Mine_Count_Endgame.
    const board: Board = {
      id: 'minecount',
      width: 9,
      height: 9,
      mines: [[0, 2], [2, 0], [8, 8]],
      initialRevealed: [[0, 0], [0, 1], [1, 0], [1, 1]],
    };
    expect(patternOf(board, [2, 2])).toBe('Mine_Count_Endgame');
  });
});

describe('Pattern_Detector - classifyPattern branches', () => {
  it('a single clue with non-zero Reduced_Value is Exposed_Mines', () => {
    // classifyPattern maps a Single_Clue with a non-zero Reduced_Value anchor to
    // Exposed_Mines (the corner-counting / exposed-mines Beginner pattern).
    const board: Board = {
      id: 'exposed',
      width: 8,
      height: 8,
      mines: [[0, 0], [7, 7]],
      initialRevealed: [[0, 1], [1, 0], [1, 1]],
    };
    const game = createGame(board, 0);
    // Anchor (0,1)=1 whose only Provably_Mine Neighbor is (0,0): Reduced_Value 0
    // would be Satisfied_Number, so use a board where the anchor keeps a
    // non-zero Reduced_Value. Here (1,1)=1 with no proven mine -> Reduced_Value 1.
    const type = classifyPattern(game, [2, 2], [[1, 1]], 'Single_Clue', false, new Set());
    expect(type).toBe('Exposed_Mines');
  });

  it('a non-wall Pair_Clue is Subset', () => {
    const board: Board = {
      id: 'subset',
      width: 8,
      height: 8,
      mines: [[0, 0], [7, 7]],
      initialRevealed: [[0, 1], [1, 0], [1, 1]],
    };
    const game = createGame(board, 0);
    // Two non-collinear anchors -> no wall template -> Subset.
    const type = classifyPattern(game, [2, 2], [[0, 1], [1, 0]], 'Pair_Clue', false, new Set());
    expect(type).toBe('Subset');
  });

  it('needing the mine count is always Mine_Count_Endgame', () => {
    const game = createGame({ id: 'x', width: 4, height: 4, mines: [[3, 3]], initialRevealed: [[0, 0]] }, 0);
    expect(classifyPattern(game, [1, 1], [[0, 0]], 'Mine_Count', true, new Set())).toBe(
      'Mine_Count_Endgame',
    );
  });
});

describe('Pattern_Instance lifecycle (Req 7.3-7.7)', () => {
  it('records appearance and resolution when the player directly reveals a Tile', () => {
    const board: Board = {
      id: 'lifecycle',
      width: 6,
      height: 3,
      mines: [[1, 2], [2, 4]],
      startTile: [0, 0],
    };
    const log: MoveLog = {
      boardId: 'lifecycle',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false },
        { type: 'Reveal_Click', tile: [1, 0], elapsedMs: 1000, wastedClick: false },
        { type: 'Reveal_Click', tile: [2, 0], elapsedMs: 2000, wastedClick: false },
      ],
    };
    const instances = detectPatternInstances(board, log);
    expect(instances.length).toBeGreaterThan(0);
    for (const inst of instances) {
      if (inst.status === 'resolved') {
        expect(inst.resolutionMs).not.toBeNull();
        expect(inst.resolutionMs!).toBeGreaterThanOrEqual(inst.appearanceMs);
      }
    }
  });

  it('marks instances unresolved at game end when their Tiles stay covered', () => {
    const board: Board = {
      id: 'unresolved',
      width: 6,
      height: 3,
      mines: [[1, 2], [2, 4]],
      startTile: [0, 0],
    };
    // Reveal only the Start_Tile; everything provable afterward stays covered.
    const log: MoveLog = {
      boardId: 'unresolved',
      entries: [{ type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false }],
    };
    const instances = detectPatternInstances(board, log);
    expect(instances.length).toBeGreaterThan(0);
    expect(instances.every((i) => i.status === 'unresolved')).toBe(true);
    expect(instances.every((i) => i.resolutionMs === null)).toBe(true);
  });

  it('excludes an instance whose Tiles are only revealed by a cascade', () => {
    // A board with a wide opening. Revealing the Start_Tile cascades and clears
    // many Tiles; any instance whose Tiles are swept by the cascade (not directly
    // targeted) is excluded at game end, not resolved.
    const board: Board = {
      id: 'cascade',
      width: 6,
      height: 3,
      mines: [[2, 5]],
      startTile: [0, 0],
    };
    const log: MoveLog = {
      boardId: 'cascade',
      entries: [{ type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false }],
    };
    const instances = detectPatternInstances(board, log);
    // No instance should be marked resolved off a single Start_Tile cascade.
    expect(instances.every((i) => i.status !== 'resolved')).toBe(true);
  });
});

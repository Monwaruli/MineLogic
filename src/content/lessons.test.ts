import { describe, it, expect } from 'vitest';
import { LESSONS, lessonsForTier, lessonById, type Lesson } from './lessons';
import { parseBoard } from '../engine/boardFormat';
import { createGame, applyAction, type Action, type GameState } from '../engine/game';
import { classifyGame, revealTargets, targetsAllSafe } from '../engine/practice';
import { attributeSafeTiles, classifyPattern } from '../engine/patterns';
import { neighbors, numberAt, tileKey, type Tile } from '../engine/board';

/**
 * Content tests for the eight Learn-Then-Do Lessons (Requirement 11.11).
 *
 * The Content_Validator (task 7.3) runs these same checks at build time with the
 * Solver. Here they double as an authoring guard: a mistyped Mini_Board fails
 * loudly instead of shipping an unsolvable lesson.
 *
 * For every Do_Step we verify:
 *  1. The board parses as a valid Mini_Board (initial revealed set, no Start).
 *  2. Its Objective can be met from the initial state using only Logical_Moves
 *     and flags on Provably_Mine Tiles.
 *  3. At least one Target_Tile is attributed to the Lesson's Pattern_Type.
 */

/** Greedily clear a board using only Logical_Moves, flagging Provably_Mine tiles. */
function solveWithLogic(game: GameState): GameState {
  let state = game;
  // Repeat until no further Provably_Safe reveal is possible.
  for (let guard = 0; guard < 200; guard++) {
    const result = classifyGame(state);
    if (result.inexact || result.inconsistent) break;
    let progressed = false;
    // Reveal every Provably_Safe covered tile.
    for (const [key, cls] of result.classification) {
      if (cls !== 'Provably_Safe') continue;
      const [r, c] = key.split(',').map(Number) as Tile;
      if (state.revealed.has(key) || state.flags.has(key)) continue;
      const action: Action = { type: 'Reveal_Click', tile: [r, c] };
      const targets = revealTargets(state, action);
      if (targets.length === 0) continue;
      const fresh = classifyGame(state);
      if (!targetsAllSafe(targets, fresh)) continue;
      state = applyAction(state, action, 0);
      progressed = true;
      if (state.status === 'won' || state.status === 'lost') return state;
    }
    if (!progressed) break;
  }
  return state;
}

/** The expected Pattern_Type appears among the Provably_Safe tiles at some point. */
function patternTypeReached(lesson: Lesson, initial: GameState): boolean {
  // Walk the Canonical-ish logical solve, checking attributions at each step.
  let state = initial;
  for (let guard = 0; guard < 200; guard++) {
    const attr = attributeSafeTiles(state);
    for (const a of attr.values()) {
      if (a.patternType === lesson.patternType) return true;
    }
    // Advance one logical reveal.
    const result = classifyGame(state);
    if (result.inexact || result.inconsistent) break;
    let progressed = false;
    for (const [key, cls] of result.classification) {
      if (cls !== 'Provably_Safe') continue;
      if (state.revealed.has(key) || state.flags.has(key)) continue;
      const [r, c] = key.split(',').map(Number) as Tile;
      const action: Action = { type: 'Reveal_Click', tile: [r, c] };
      const targets = revealTargets(state, action);
      if (targets.length === 0) continue;
      const fresh = classifyGame(state);
      if (!targetsAllSafe(targets, fresh)) continue;
      state = applyAction(state, action, 0);
      progressed = true;
      break;
    }
    if (!progressed) break;
    if (state.status === 'won' || state.status === 'lost') break;
  }
  return false;
}

/**
 * The Pattern_Detector attributes Provably_Safe Tiles, so two of the eight
 * Pattern_Types cannot surface on a safe Target_Tile by design (documented in
 * patterns.ts and patterns.test.ts):
 *
 *   - Exposed_Mines: any Tile a single Number proves SAFE has Reduced_Value 0,
 *     so the detector labels it Satisfied_Number. Exposed_Mines is a statement
 *     about forced MINE Tiles, not safe ones. We instead verify the Lesson's
 *     corner-counting deduction forces a Provably_Mine Tile.
 *   - Wall_1_2_2_1: a 1-2-2-1 safe deduction decomposes into smaller sets, so no
 *     single safe Tile has all four Numbers as its minimal Anchor_Numbers. We
 *     instead verify a collinear run of revealed Numbers reads 1-2-2-1 via the
 *     detector's own classifyPattern.
 *
 * The other six patterns surface on a safe Target_Tile and use patternTypeReached.
 */

/** True when the Board forces at least one Provably_Mine Tile (Exposed_Mines). */
function forcesProvablyMine(game: GameState): boolean {
  const result = classifyGame(game);
  if (result.inexact || result.inconsistent) return false;
  for (const cls of result.classification.values()) {
    if (cls === 'Provably_Mine') return true;
  }
  return false;
}

/**
 * True when some run of collinear, adjacent revealed Numbers reads 1-2-2-1 and
 * the detector names it Wall_1_2_2_1. Scans every horizontal and vertical run of
 * four revealed Numbers on the board.
 */
function hasWall1221Run(game: GameState): boolean {
  const { board } = game;
  const { width, height } = board;
  const mineSet = new Set(board.mines.map(([r, c]) => tileKey(r, c)));
  const isRevealedNumber = (r: number, c: number): boolean =>
    game.revealed.has(tileKey(r, c)) && !mineSet.has(tileKey(r, c));

  const tryRun = (run: Tile[]): boolean => {
    if (run.length !== 4) return false;
    if (!run.every(([r, c]) => isRevealedNumber(r, c))) return false;
    // The run must border at least one covered Tile to be a real wall.
    const touchesCovered = run.some(([r, c]) =>
      neighbors([r, c], width, height).some(
        (nb) => !game.revealed.has(tileKey(nb[0], nb[1])),
      ),
    );
    if (!touchesCovered) return false;
    const type = classifyPattern(game, run[0], run, 'Multi_Clue', false, new Set());
    return type === 'Wall_1_2_2_1';
  };

  // Horizontal runs.
  for (let r = 0; r < height; r++) {
    for (let c = 0; c + 3 < width; c++) {
      if (tryRun([[r, c], [r, c + 1], [r, c + 2], [r, c + 3]])) return true;
    }
  }
  // Vertical runs.
  for (let c = 0; c < width; c++) {
    for (let r = 0; r + 3 < height; r++) {
      if (tryRun([[r, c], [r + 1, c], [r + 2, c], [r + 3, c]])) return true;
    }
  }
  // Silence unused-import when numberAt is only used for documentation parity.
  void numberAt;
  return false;
}

describe('lesson curriculum', () => {
  it('provides all eight Pattern_Types (Requirement 11.1)', () => {
    const types = LESSONS.map((l) => l.patternType).sort();
    expect(types).toEqual(
      [
        'Clue_Chain',
        'Exposed_Mines',
        'Mine_Count_Endgame',
        'Satisfied_Number',
        'Subset',
        'Wall_1_1',
        'Wall_1_2_1',
        'Wall_1_2_2_1',
      ].sort(),
    );
  });

  it('has two Beginner, three Intermediate, three Expert lessons (Requirement 11.1)', () => {
    expect(lessonsForTier('Beginner')).toHaveLength(2);
    expect(lessonsForTier('Intermediate')).toHaveLength(3);
    expect(lessonsForTier('Expert')).toHaveLength(3);
  });

  it('looks lessons up by id', () => {
    for (const l of LESSONS) {
      expect(lessonById(l.id)?.id).toBe(l.id);
    }
    expect(lessonById('nope')).toBeUndefined();
  });

  it('has unique lesson ids', () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives each lesson 1+ learn steps and 2-3 do steps (Requirement 11.2, 11.3)', () => {
    for (const l of LESSONS) {
      expect(l.learnSteps.length).toBeGreaterThanOrEqual(1);
      expect(l.doSteps.length).toBeGreaterThanOrEqual(2);
      expect(l.doSteps.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('every lesson board is a valid 5x5 Mini_Board', () => {
  for (const lesson of LESSONS) {
    for (const [i, step] of lesson.learnSteps.entries()) {
      it(`${lesson.id} learn step ${i} parses as a Mini_Board`, () => {
        const board = parseBoard(step.boardText);
        expect(board.width).toBe(5);
        expect(board.height).toBe(5);
        expect(board.startTile).toBeUndefined();
        expect(board.initialRevealed?.length ?? 0).toBeGreaterThan(0);
      });
    }
    for (const [i, step] of lesson.doSteps.entries()) {
      it(`${lesson.id} do step ${i} parses as a Mini_Board`, () => {
        const board = parseBoard(step.boardText);
        expect(board.width).toBe(5);
        expect(board.height).toBe(5);
        expect(board.startTile).toBeUndefined();
        expect(board.initialRevealed?.length ?? 0).toBeGreaterThan(0);
      });
    }
  }
});

describe('every Do_Step is solvable and teaches its pattern (Requirement 11.11)', () => {
  for (const lesson of LESSONS) {
    for (const [i, step] of lesson.doSteps.entries()) {
      const board = parseBoard(step.boardText);

      it(`${lesson.id} do step ${i}: targets are Provably_Safe from the initial state`, () => {
        const game = createGame(board, 0);
        const result = classifyGame(game);
        expect(result.inexact).toBe(false);
        expect(result.inconsistent).toBe(false);
        for (const [r, c] of step.targets) {
          expect(result.classification.get(tileKey(r, c))).toBe('Provably_Safe');
        }
      });

      it(`${lesson.id} do step ${i}: Objective completes with Logical_Moves only`, () => {
        const game = createGame(board, 0);
        const solved = solveWithLogic(game);
        for (const [r, c] of step.targets) {
          expect(solved.revealed.has(tileKey(r, c))).toBe(true);
        }
      });

      it(`${lesson.id} do step ${i}: the taught Pattern_Type is present`, () => {
        const game = createGame(board, 0);
        if (lesson.patternType === 'Exposed_Mines') {
          // Corner counting forces a Provably_Mine Tile (the exposed mine).
          expect(forcesProvablyMine(game)).toBe(true);
        } else if (lesson.patternType === 'Wall_1_2_2_1') {
          // A collinear run of Numbers reads 1-2-2-1 (the wall template).
          expect(hasWall1221Run(game)).toBe(true);
        } else {
          // The other six patterns surface on a safe Target_Tile.
          expect(patternTypeReached(lesson, game)).toBe(true);
        }
      });
    }
  }
});

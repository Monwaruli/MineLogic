import { describe, it, expect } from 'vitest';
import {
  CHECKPOINT_VARIATIONS,
  variationsForTier,
  variationById,
  type CheckpointVariation,
} from './checkpoints';
import type { Tier } from './lessons';
import { parseBoard } from '../engine/boardFormat';
import { createGame, applyAction, type Action, type GameState } from '../engine/game';
import { classifyGame, revealTargets, targetsAllSafe } from '../engine/practice';
import { attributeSafeTiles } from '../engine/patterns';
import type { PatternType } from '../engine/patterns';
import type { Tile } from '../engine/board';

/**
 * Content tests for the Mastery_Checkpoint Checkpoint_Variations (Requirement
 * 13.6, 13.7). The Content_Validator (task 7.3) runs these same checks at build
 * time with the Solver; here they double as an authoring guard so a mistyped
 * Mini_Board fails loudly.
 *
 * For every variation we verify:
 *  1. The board parses as a valid 5x5 Mini_Board (initial revealed set, no Start).
 *  2. It can be cleared from its initial state using only Logical_Moves (13.7).
 *  3. Its first required deduction is attributed to a Pattern_Type of its tier
 *     (13.7).
 */

/** Pattern_Types that belong to each tier (glossary). */
const TIER_PATTERNS: Record<Tier, PatternType[]> = {
  Beginner: ['Exposed_Mines', 'Satisfied_Number'],
  Intermediate: ['Wall_1_1', 'Wall_1_2_1', 'Wall_1_2_2_1'],
  Expert: ['Subset', 'Clue_Chain', 'Mine_Count_Endgame'],
};

/**
 * Greedily clear a board using only Logical_Moves and flags on Provably_Mine
 * Tiles (Requirement 13.7, like the Lesson rule in 11.11): reveal every
 * Provably_Safe Tile and flag every Provably_Mine Tile until the board is won.
 * Flagging mines lets the win condition (every non-mine Tile revealed) be
 * reached even on boards whose last safe reveals sit beside a forced mine.
 */
function solveWithLogic(game: GameState): GameState {
  let state = game;
  for (let guard = 0; guard < 400; guard++) {
    const result = classifyGame(state);
    if (result.inexact || result.inconsistent) break;
    let progressed = false;

    // Flag every Provably_Mine Tile that is not yet flagged.
    for (const [key, cls] of result.classification) {
      if (cls !== 'Provably_Mine') continue;
      if (state.flags.has(key)) continue;
      const [r, c] = key.split(',').map(Number) as Tile;
      state = applyAction(state, { type: 'Flag_Toggle', tile: [r, c] }, 0);
      progressed = true;
    }

    // Reveal every Provably_Safe covered Tile.
    const safeResult = classifyGame(state);
    if (!safeResult.inexact && !safeResult.inconsistent) {
      for (const [key, cls] of safeResult.classification) {
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
        if (state.status === 'won' || state.status === 'lost') return state;
      }
    }

    if (!progressed) break;
  }
  return state;
}

/**
 * The Pattern_Type of the first required deduction: the attribution of the
 * Provably_Safe Tiles available at the initial Board_State. Two tier patterns
 * (Exposed_Mines, Wall_1_2_2_1) never surface on a safe Tile by the detector's
 * design (documented in patterns.ts), so we treat the tier's patterns as a set
 * and accept any one of them appearing in the initial attribution — plus the
 * structural checks below for those two.
 */
function initialSafePatterns(game: GameState): Set<PatternType> {
  const types = new Set<PatternType>();
  for (const a of attributeSafeTiles(game).values()) types.add(a.patternType);
  return types;
}

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
 * The initial deduction belongs to the variation's tier: at least one of the
 * tier's Pattern_Types is attributed to a Provably_Safe Tile at the initial
 * state, OR (for the two patterns that do not surface on a safe Tile) the
 * corresponding structural condition holds.
 */
function firstDeductionInTier(v: CheckpointVariation, game: GameState): boolean {
  const safePatterns = initialSafePatterns(game);
  const tierPatterns = TIER_PATTERNS[v.tier];
  if (tierPatterns.some((p) => safePatterns.has(p))) return true;

  // Beginner Exposed_Mines variations prove a mine, not a safe Tile, as the
  // first deduction (the Pattern_Detector attributes a single-Number safe Tile
  // with Reduced_Value 0 as Satisfied_Number; Exposed_Mines is a statement about
  // forced MINE Tiles). Accept a Beginner board that forces a Provably_Mine
  // Tile, matching the lesson convention in lessons.test.ts.
  if (v.tier === 'Beginner' && forcesProvablyMine(game)) return true;

  return false;
}

describe('checkpoint pools', () => {
  it('provides at least six variations per tier (Requirement 13.6)', () => {
    expect(variationsForTier('Beginner').length).toBeGreaterThanOrEqual(6);
    expect(variationsForTier('Intermediate').length).toBeGreaterThanOrEqual(6);
    expect(variationsForTier('Expert').length).toBeGreaterThanOrEqual(6);
  });

  it('has unique variation ids', () => {
    const ids = CHECKPOINT_VARIATIONS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('looks variations up by id', () => {
    for (const v of CHECKPOINT_VARIATIONS) {
      expect(variationById(v.id)?.id).toBe(v.id);
    }
    expect(variationById('nope')).toBeUndefined();
  });

  it('tags every variation with a known tier', () => {
    for (const v of CHECKPOINT_VARIATIONS) {
      expect(['Beginner', 'Intermediate', 'Expert']).toContain(v.tier);
    }
  });
});

describe('every variation is a valid 5x5 Mini_Board', () => {
  for (const v of CHECKPOINT_VARIATIONS) {
    it(`${v.id} parses as a Mini_Board`, () => {
      const board = parseBoard(v.boardText);
      expect(board.width).toBe(5);
      expect(board.height).toBe(5);
      expect(board.startTile).toBeUndefined();
      expect(board.initialRevealed?.length ?? 0).toBeGreaterThan(0);
    });
  }
});

describe('every variation clears with Logical_Moves and teaches its tier (Requirement 13.7)', () => {
  for (const v of CHECKPOINT_VARIATIONS) {
    const board = parseBoard(v.boardText);

    it(`${v.id}: initial state is exactly solvable (not inexact/inconsistent)`, () => {
      const result = classifyGame(createGame(board, 0));
      expect(result.inexact).toBe(false);
      expect(result.inconsistent).toBe(false);
    });

    it(`${v.id}: has at least one Provably_Safe tile at the start`, () => {
      const result = classifyGame(createGame(board, 0));
      const anySafe = [...result.classification.values()].some(
        (c) => c === 'Provably_Safe',
      );
      expect(anySafe).toBe(true);
    });

    it(`${v.id}: clears to a win using only Logical_Moves`, () => {
      const solved = solveWithLogic(createGame(board, 0));
      expect(solved.status).toBe('won');
    });

    it(`${v.id}: first required deduction is attributed to its tier`, () => {
      expect(firstDeductionInTier(v, createGame(board, 0))).toBe(true);
    });
  }
});

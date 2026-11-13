import { describe, it, expect } from 'vitest';
import {
  SKILL_CHECK_SNIPPETS,
  snippetForTier,
  snippetById,
} from './skillCheck';
import type { Tier } from './lessons';
import { parseBoard } from '../engine/boardFormat';
import { createGame } from '../engine/game';
import { classifyGame } from '../engine/practice';
import { attributeSafeTiles, type PatternType } from '../engine/patterns';
import { tileKey } from '../engine/board';

/**
 * Content tests for the Skill_Check_Snippets (Requirement 10.8, 10.9). The
 * Content_Validator (task 7.3) runs these same checks at build time with the
 * Solver; here they double as an authoring guard so a mistyped snippet fails
 * loudly.
 *
 * For every snippet we verify:
 *  1. It parses as a valid partly-revealed Mini_Board (initial revealed set).
 *  2. It has exactly one Provably_Safe covered Tile, and that Tile is the
 *     authored `safeTile` (Requirement 10.8).
 *  3. It has at least one Trap_Tile, and no Trap_Tile is Provably_Safe (10.8).
 *  4. Its Provably_Safe Tile is attributed to a Pattern_Type of the snippet's
 *     tier, with the Intermediate snippet attributed to Wall_1_2_1 (10.9).
 */

const TIER_PATTERNS: Record<Tier, PatternType[]> = {
  Beginner: ['Exposed_Mines', 'Satisfied_Number'],
  Intermediate: ['Wall_1_1', 'Wall_1_2_1', 'Wall_1_2_2_1'],
  Expert: ['Subset', 'Clue_Chain', 'Mine_Count_Endgame'],
};

/** The keys of every Provably_Safe covered Tile in a snippet's initial state. */
function provablySafeKeys(boardText: string): Set<string> {
  const game = createGame(parseBoard(boardText), 0);
  const result = classifyGame(game);
  expect(result.inexact).toBe(false);
  expect(result.inconsistent).toBe(false);
  const keys = new Set<string>();
  for (const [key, cls] of result.classification) {
    if (cls === 'Provably_Safe') keys.add(key);
  }
  return keys;
}

describe('skill-check snippet set', () => {
  it('has one snippet per tier in Beginner, Intermediate, Expert order (10.1)', () => {
    expect(SKILL_CHECK_SNIPPETS.map((s) => s.tier)).toEqual([
      'Beginner',
      'Intermediate',
      'Expert',
    ]);
  });

  it('has unique snippet ids', () => {
    const ids = SKILL_CHECK_SNIPPETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('looks snippets up by id and tier', () => {
    for (const s of SKILL_CHECK_SNIPPETS) {
      expect(snippetById(s.id)?.id).toBe(s.id);
      expect(snippetForTier(s.tier)?.id).toBe(s.id);
    }
    expect(snippetById('nope')).toBeUndefined();
  });
});

describe('every snippet is a valid partly-revealed Mini_Board', () => {
  for (const s of SKILL_CHECK_SNIPPETS) {
    it(`${s.id} parses with an initial revealed set and no Start_Tile`, () => {
      const board = parseBoard(s.boardText);
      expect(board.startTile).toBeUndefined();
      expect(board.initialRevealed?.length ?? 0).toBeGreaterThan(0);
    });
  }
});

describe('every snippet has exactly one Provably_Safe tile (Requirement 10.8)', () => {
  for (const s of SKILL_CHECK_SNIPPETS) {
    it(`${s.id}: exactly one Provably_Safe covered tile, equal to safeTile`, () => {
      const safe = provablySafeKeys(s.boardText);
      expect(safe.size).toBe(1);
      expect(safe.has(tileKey(s.safeTile[0], s.safeTile[1]))).toBe(true);
    });
  }
});

describe('every snippet has valid Trap_Tiles (Requirement 10.8)', () => {
  for (const s of SKILL_CHECK_SNIPPETS) {
    it(`${s.id}: at least one trap, none Provably_Safe`, () => {
      expect(s.traps.length).toBeGreaterThanOrEqual(1);
      const safe = provablySafeKeys(s.boardText);
      for (const { tile } of s.traps) {
        expect(safe.has(tileKey(tile[0], tile[1]))).toBe(false);
      }
    });

    it(`${s.id}: no trap coincides with the safe tile`, () => {
      const safeKey = tileKey(s.safeTile[0], s.safeTile[1]);
      for (const { tile } of s.traps) {
        expect(tileKey(tile[0], tile[1])).not.toBe(safeKey);
      }
    });
  }
});

/** True when the board forces at least one Provably_Mine tile (Exposed_Mines). */
function forcesProvablyMine(boardText: string): boolean {
  const result = classifyGame(createGame(parseBoard(boardText), 0));
  if (result.inexact || result.inconsistent) return false;
  for (const cls of result.classification.values()) {
    if (cls === 'Provably_Mine') return true;
  }
  return false;
}

describe('every snippet surfaces its tier deduction (Requirement 10.9)', () => {
  // The Intermediate and Expert snippets surface their tier pattern on the safe
  // tile. The Beginner snippet's key deduction is a forced MINE (corner counting
  // / Exposed_Mines), which the detector never attributes to a safe tile, so —
  // like lessons.test.ts and checkpoints.test.ts — the Beginner tier is verified
  // by the Provably_Mine tile it forces.
  it('the Beginner snippet forces a Provably_Mine tile (corner counting)', () => {
    const beg = snippetForTier('Beginner')!;
    expect(forcesProvablyMine(beg.boardText)).toBe(true);
  });

  it('the Intermediate snippet safe tile is attributed Wall_1_2_1 (10.9)', () => {
    const inter = snippetForTier('Intermediate')!;
    const game = createGame(parseBoard(inter.boardText), 0);
    const attr = attributeSafeTiles(game).get(
      tileKey(inter.safeTile[0], inter.safeTile[1]),
    );
    expect(attr?.patternType).toBe('Wall_1_2_1');
  });

  it('the Expert snippet safe tile is attributed to an Expert-tier pattern', () => {
    const exp = snippetForTier('Expert')!;
    const game = createGame(parseBoard(exp.boardText), 0);
    const attr = attributeSafeTiles(game).get(
      tileKey(exp.safeTile[0], exp.safeTile[1]),
    );
    expect(attr).toBeDefined();
    expect(TIER_PATTERNS.Expert).toContain(attr!.patternType);
  });
});

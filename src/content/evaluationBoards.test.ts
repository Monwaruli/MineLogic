import { describe, it, expect } from 'vitest';
import { DIFFICULTIES } from '../engine/board';
import { generate } from '../engine/generator';
import { printBoard } from '../engine/boardFormat';
import {
  boardSignature,
  signaturesMatch,
  validateEvaluationBoard,
  validateEvaluationBoards,
  type EvaluationBoards,
} from './validate';
import { variationsForTier } from './checkpoints';

/**
 * A Beginner-only Mini_Board that clears with Logical_Moves and whose solve
 * path uses only Beginner-tier patterns. The authored Beginner
 * Checkpoint_Variations are exactly this by construction (Requirement 13.7), so
 * one makes a reliable "missing Intermediate pattern" fixture.
 */
const BEGINNER_ONLY_BOARD = (() => {
  const v = variationsForTier('Beginner').find((x) => x.id === 'cp-beginner-4');
  if (!v) throw new Error('expected Beginner checkpoint variation cp-beginner-4');
  return v.boardText;
})();

/** A generated Beginner No_Guess_Board as Board_Format text (clears by logic). */
function beginnerBoard(seed: number): string {
  return printBoard(generate(DIFFICULTIES.Beginner, seed).board);
}

/**
 * A guessy / unsolvable fixture: the classic 50/50. A 1x3 Mini_Board with the
 * middle Tile revealed showing a 1 and one mine total: the mine is equally
 * likely to be the left or right covered Tile, so neither is Provably_Safe and
 * the Solver reports an inexact state — NOT a No_Guess_Board.
 */
const GUESSY_BOARD = [
  'version 1',
  'id guessy',
  'width 3',
  'height 1',
  'mines 1',
  'mine 0 0',
  'revealed 0 1',
  '',
].join('\n');

describe('boardSignature + signaturesMatch (Requirement 22.5)', () => {
  it('two prints of the same board have an identical signature', () => {
    const text = beginnerBoard(3);
    const a = boardSignature(text);
    const b = boardSignature(text);
    expect(signaturesMatch(a, b)).toBe(true);
    expect(a.width).toBe(DIFFICULTIES.Beginner.width);
    expect(a.mineCount).toBe(DIFFICULTIES.Beginner.mines);
  });

  it('different boards usually differ in 3BV (dimensions/mines equal)', () => {
    const a = boardSignature(beginnerBoard(1));
    const b = boardSignature(beginnerBoard(2));
    // Same difficulty => same dims + mine count, but the 3BV generally differs.
    expect(a.width).toBe(b.width);
    expect(a.mineCount).toBe(b.mineCount);
    // If, by chance, 3BV matched, the pair would be considered matched; that is
    // acceptable for 22.5. We only assert the signature mechanism works.
    expect(typeof a.threeBV).toBe('number');
  });
});

describe('validateEvaluationBoard (Requirement 22.6)', () => {
  it('a generated Beginner board passes (No_Guess, Beginner-tier coverage)', () => {
    const issues = validateEvaluationBoard('Pre_Beginner', 'Beginner', beginnerBoard(5));
    expect(issues).toEqual([]);
  });

  it('a guessy / unsolvable board fails 22.6', () => {
    const issues = validateEvaluationBoard('Pre_Beginner', 'Beginner', GUESSY_BOARD);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => /No_Guess_Board|Logical_Moves|inexact/i.test(i.message))).toBe(true);
  });

  it('a Beginner-only board validated at Intermediate fails the missing-tier check', () => {
    // A board whose Canonical_Solve_Path uses only Beginner-tier patterns does
    // not satisfy Intermediate coverage, so requiring it should flag the board.
    const issues = validateEvaluationBoard('Pre_Intermediate', 'Intermediate', BEGINNER_ONLY_BOARD);
    expect(issues.some((i) => /Intermediate-tier Pattern_Instance/i.test(i.message))).toBe(true);
  });

  it('unparsable text fails to parse', () => {
    const issues = validateEvaluationBoard('Pre_Beginner', 'Beginner', 'not a board');
    expect(issues.some((i) => /fails to parse/i.test(i.message))).toBe(true);
  });
});

describe('validateEvaluationBoards config-level checks (Requirements 22.4, 22.5)', () => {
  function baseConfig(overrides: Partial<EvaluationBoards> = {}): EvaluationBoards {
    const pb = beginnerBoard(5);
    return {
      preBeginner: pb,
      preIntermediate: null, // Intermediate boards are hard to fixture; test the Beginner pair + required-board logic
      postBeginner: pb,
      postIntermediate: null,
      postExpert: null,
      includesExpert: false,
      ...overrides,
    };
  }

  it('matched Post_Beginner == Pre_Beginner passes 22.5 for that pair', () => {
    const cfg = baseConfig();
    const issues = validateEvaluationBoards(cfg);
    // No mismatch issue for the Beginner pair (same text => same signature).
    expect(issues.some((i) => i.id === 'Post_Beginner vs Pre_Beginner')).toBe(false);
  });

  it('a Post_Beginner with a different 3BV than Pre_Beginner fails 22.5', () => {
    const cfg = baseConfig({ postBeginner: beginnerBoard(42) });
    const issues = validateEvaluationBoards(cfg);
    // Seeds 5 and 42 produce different layouts; if their 3BV happens to match,
    // retry with another seed deterministically.
    const mismatch = issues.find((i) => i.id === 'Post_Beginner vs Pre_Beginner');
    if (!mismatch) {
      const cfg2 = baseConfig({ postBeginner: beginnerBoard(99) });
      const issues2 = validateEvaluationBoards(cfg2);
      expect(issues2.some((i) => i.id === 'Post_Beginner vs Pre_Beginner')).toBe(true);
    } else {
      expect(mismatch.message).toMatch(/dimensions, mine count, and 3BV/);
    }
  });

  it('Post_Expert is NOT required when the config excludes Expert (22.4)', () => {
    const cfg = baseConfig({ includesExpert: false, postExpert: null });
    const issues = validateEvaluationBoards(cfg);
    expect(issues.some((i) => i.id === 'Post_Expert')).toBe(false);
  });

  it('Post_Expert IS required when the config includes Expert (22.4)', () => {
    const cfg = baseConfig({ includesExpert: true, postExpert: null });
    const issues = validateEvaluationBoards(cfg);
    expect(issues.some((i) => i.id === 'Post_Expert' && /required/i.test(i.message))).toBe(true);
  });
});

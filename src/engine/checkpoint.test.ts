import { describe, it, expect } from 'vitest';
import {
  advanceAfterSlip,
  applyCheckpointAction,
  createCheckpoint,
  seededChooser,
  variationCleared,
  REQUIRED_STREAK,
  type CheckpointState,
  type VariationChooser,
} from './checkpoint';
import { variationsForTier } from '../content/checkpoints';
import { parseBoard } from './boardFormat';
import { createGame, type Action, type GameState } from './game';
import { classifyGame, revealTargets, targetsAllSafe } from './practice';
import { tileKey, type Tile } from './board';
import type { Tier } from '../content/lessons';

/**
 * Unit tests for the Mastery_Checkpoint engine (Requirement 13.1-13.6).
 *
 * The engine decides Logical_Moves, Slips, streaks, resets, and passing; these
 * tests drive it with the same greedy logical solver the content tests use, so
 * a "clear" means a real logical clearance, not a scripted move list.
 */

/** Every Provably_Safe covered Tile's Reveal_Click, in classification order. */
function nextSafeReveal(game: GameState): Action | null {
  const result = classifyGame(game);
  if (result.inexact || result.inconsistent) return null;
  for (const [key, cls] of result.classification) {
    if (cls !== 'Provably_Safe') continue;
    if (game.revealed.has(key) || game.flags.has(key)) continue;
    const [r, c] = key.split(',').map(Number) as Tile;
    const action: Action = { type: 'Reveal_Click', tile: [r, c] };
    const targets = revealTargets(game, action);
    if (targets.length === 0) continue;
    if (!targetsAllSafe(targets, result)) continue;
    return action;
  }
  return null;
}

/**
 * Clear the current variation with Logical_Moves, returning the state after the
 * clearing action (which, in the engine, already presents the next variation or
 * latches `passed`). Fails the test if it cannot make progress.
 */
function clearCurrentVariation(state: CheckpointState): CheckpointState {
  let s = state;
  for (let guard = 0; guard < 100; guard++) {
    const before = s.currentId;
    const action = nextSafeReveal(s.game);
    if (!action) {
      throw new Error(`stuck on ${s.currentId} with no logical move`);
    }
    const result = applyCheckpointAction(s, action);
    s = result.state;
    // Clearing advances the variation id (or passes); detect that transition.
    if (s.passed || s.currentId !== before) return s;
  }
  throw new Error('variation did not clear within the guard');
}

/** Find the first Provably_Mine Tile in a game, or null. */
function firstProvablyMine(game: GameState): Tile | null {
  const result = classifyGame(game);
  for (const [key, cls] of result.classification) {
    if (cls === 'Provably_Mine') {
      const [r, c] = key.split(',').map(Number) as Tile;
      return [r, c];
    }
  }
  return null;
}

/** Find a covered Tile that is NOT Provably_Safe (a Guess target), or null. */
function firstNonSafeCovered(game: GameState): Tile | null {
  const result = classifyGame(game);
  for (const [key, cls] of result.classification) {
    if (cls === 'Provably_Safe') continue;
    if (game.revealed.has(key) || game.flags.has(key)) continue;
    const [r, c] = key.split(',').map(Number) as Tile;
    return [r, c];
  }
  return null;
}

const tiers: Tier[] = ['Beginner', 'Intermediate', 'Expert'];

describe('createCheckpoint', () => {
  it('throws on an empty pool', () => {
    expect(() => createCheckpoint([])).toThrow();
  });

  for (const tier of tiers) {
    it(`${tier}: starts at zero streak, not passed, with a parsed board`, () => {
      const state = createCheckpoint(variationsForTier(tier), seededChooser(0));
      expect(state.streak).toBe(0);
      expect(state.passed).toBe(false);
      expect(state.pendingReset).toBe(false);
      expect(state.game.board.width).toBe(5);
    });
  }
});

describe('passing a checkpoint (Requirement 13.2, 13.4)', () => {
  for (const tier of tiers) {
    it(`${tier}: three unassisted clears in a row pass the checkpoint`, () => {
      let state = createCheckpoint(variationsForTier(tier), seededChooser(1));
      for (let i = 0; i < REQUIRED_STREAK; i++) {
        expect(state.passed).toBe(false);
        state = clearCurrentVariation(state);
      }
      expect(state.streak).toBe(REQUIRED_STREAK);
      expect(state.passed).toBe(true);
    });
  }
});

describe('a Slip resets the streak and presents a new variation (Requirement 13.3)', () => {
  it('a Guess (reveal of a non-Provably_Safe tile) is a Slip', () => {
    // Use Intermediate so there is a covered, not-provably-safe tile to click.
    let state = createCheckpoint(variationsForTier('Intermediate'), seededChooser(2));
    // Build a streak of two first.
    state = clearCurrentVariation(state);
    state = clearCurrentVariation(state);
    expect(state.streak).toBe(2);

    const guess = firstNonSafeCovered(state.game);
    expect(guess).not.toBeNull();
    const before = state.game;
    const prevId = state.currentId;

    const result = applyCheckpointAction(state, {
      type: 'Reveal_Click',
      tile: guess!,
    });

    // The action is left unapplied: the board is unchanged.
    expect(result.state.game).toBe(before);
    // The slipped tile is marked and a reset is armed.
    expect(result.state.slippedTile).toEqual(guess);
    expect(result.state.pendingReset).toBe(true);
    // The streak is reset to zero.
    expect(result.state.streak).toBe(0);
    expect(result.message).not.toBeNull();

    // Advancing presents a fresh, different variation.
    const advanced = advanceAfterSlip(result.state);
    expect(advanced.pendingReset).toBe(false);
    expect(advanced.slippedTile).toBeNull();
    expect(advanced.currentId).not.toBe(prevId);
    expect(advanced.streak).toBe(0);
  });

  it('a Wrong_Flag (flag on a non-Provably_Mine tile) is a Slip', () => {
    let state = createCheckpoint(variationsForTier('Beginner'), seededChooser(3));
    state = clearCurrentVariation(state);
    expect(state.streak).toBe(1);

    // Flag a Provably_Safe tile -> Wrong_Flag.
    const result = classifyGame(state.game);
    let safeTile: Tile | null = null;
    for (const [key, cls] of result.classification) {
      if (cls === 'Provably_Safe' && !state.game.revealed.has(key)) {
        const [r, c] = key.split(',').map(Number) as Tile;
        safeTile = [r, c];
        break;
      }
    }
    expect(safeTile).not.toBeNull();

    const before = state.game;
    const out = applyCheckpointAction(state, { type: 'Flag_Toggle', tile: safeTile! });
    expect(out.state.game).toBe(before); // unapplied
    expect(out.state.streak).toBe(0);
    expect(out.state.pendingReset).toBe(true);
    expect(out.state.slippedTile).toEqual(safeTile);
  });

  it('flagging a Provably_Mine tile is NOT a Slip and applies', () => {
    const state = createCheckpoint(variationsForTier('Beginner'), seededChooser(0));
    const mine = firstProvablyMine(state.game);
    expect(mine).not.toBeNull();
    const out = applyCheckpointAction(state, { type: 'Flag_Toggle', tile: mine! });
    expect(out.message).toBeNull();
    expect(out.state.pendingReset).toBe(false);
    expect(out.state.game.flags.has(tileKey(mine![0], mine![1]))).toBe(true);
  });
});

describe('the next variation is always different (Requirement 13.6)', () => {
  for (const tier of tiers) {
    it(`${tier}: clearing never immediately repeats the same variation`, () => {
      let state = createCheckpoint(variationsForTier(tier), seededChooser(5));
      for (let i = 0; i < REQUIRED_STREAK - 1; i++) {
        const prev = state.currentId;
        state = clearCurrentVariation(state);
        if (!state.passed) {
          expect(state.currentId).not.toBe(prev);
        }
      }
    });
  }
});

describe('pending-reset: the next action advances past the failed board', () => {
  it('any action while a reset is pending just presents the fresh variation', () => {
    let state = createCheckpoint(variationsForTier('Intermediate'), seededChooser(7));
    const guess = firstNonSafeCovered(state.game)!;
    const prevId = state.currentId;
    state = applyCheckpointAction(state, { type: 'Reveal_Click', tile: guess }).state;
    expect(state.pendingReset).toBe(true);

    // A subsequent action resolves the reset and does not play on the new board.
    const after = applyCheckpointAction(state, {
      type: 'Reveal_Click',
      tile: [0, 0],
    }).state;
    expect(after.pendingReset).toBe(false);
    expect(after.currentId).not.toBe(prevId);
    // The new board has no reveals beyond its initial revealed set yet.
    const freshGame = createGame(parseBoard(after.current.boardText), 0);
    expect(after.game.revealed.size).toBe(freshGame.revealed.size);
  });
});

describe('a passed checkpoint ignores further actions (Requirement 13.4)', () => {
  it('stays passed and unchanged after more clicks', () => {
    let state = createCheckpoint(variationsForTier('Beginner'), seededChooser(9));
    for (let i = 0; i < REQUIRED_STREAK; i++) state = clearCurrentVariation(state);
    expect(state.passed).toBe(true);
    const out = applyCheckpointAction(state, { type: 'Reveal_Click', tile: [0, 0] });
    expect(out.state).toBe(state);
    expect(out.message).toBeNull();
  });
});

describe('seededChooser', () => {
  it('never returns the excluded id when the pool has more than one', () => {
    const pool = variationsForTier('Beginner');
    const chooser: VariationChooser = seededChooser(42);
    let excludeId: string | null = null;
    for (let i = 0; i < 20; i++) {
      const idx = chooser(pool, excludeId);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(pool.length);
      expect(pool[idx].id).not.toBe(excludeId);
      excludeId = pool[idx].id;
    }
  });
});

describe('variationCleared', () => {
  it('reports true only when the current variation is won', () => {
    const state = createCheckpoint(variationsForTier('Beginner'), seededChooser(0));
    expect(variationCleared(state)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  applyDoStepAction,
  createDoStepState,
  objectiveMet,
  NOT_PROVABLE_MESSAGE,
  USE_CHORD_MESSAGE,
  type DoStepState,
} from './tutorial';
import { tileKey, type Tile } from './board';
import type { Action } from './game';
import { lessonById, type DoStep, type Lesson } from '../content/lessons';

/**
 * Tests for the pure Tutorial_Player engine (task 7.1, Requirement 11.4-11.8).
 *
 * These exercise the Do_Step pipeline directly on the authored Lesson content:
 *  - A Logical_Move (all Target_Tiles Provably_Safe) and a flag on a
 *    Provably_Mine Tile are applied (11.4).
 *  - A reveal of a non-provable Tile, or a flag on a non-mine Tile, is left
 *    unapplied, marks the attempted Tile, and returns the "not provable yet"
 *    message (11.5).
 *  - A chord-Objective step that is revealed with a plain click resets the
 *    Mini_Board and asks for a chord (11.6).
 *  - The Objective is met only when every Target_Tile is revealed (11.7/11.8).
 */

const exposed = lessonById('beginner-exposed-mines')!;
const satisfied = lessonById('beginner-satisfied-number')!;

/** The id of the mine Tile that is Provably_Mine on a Do_Step's board. */
function provablyMineTile(state: DoStepState): Tile {
  return state.board.mines[0];
}

/** Reveal a Tile through the pipeline and return the next state. */
function reveal(state: DoStepState, tile: Tile) {
  const action: Action = { type: 'Reveal_Click', tile };
  return applyDoStepAction(state, action);
}

describe('createDoStepState', () => {
  it('parses the Mini_Board and starts it playing with the revealed set', () => {
    const step = exposed.doSteps[0];
    const state = createDoStepState(step);
    expect(state.board.width).toBe(5);
    expect(state.board.height).toBe(5);
    expect(state.game.status).toBe('playing');
    expect(state.markedTile).toBeNull();
    expect(objectiveMet(state)).toBe(false);
  });
});

describe('Do_Step reveal rules (Req 11.4, 11.5)', () => {
  it('applies a Logical_Move on a Provably_Safe Target_Tile and completes the Objective', () => {
    const step = exposed.doSteps[0];
    let state = createDoStepState(step);
    for (const [r, c] of step.targets) {
      const result = reveal(state, [r, c]);
      expect(result.message).toBeNull();
      state = result.state;
      expect(state.game.revealed.has(tileKey(r, c))).toBe(true);
    }
    expect(objectiveMet(state)).toBe(true);
  });

  it('intercepts a reveal of a non-provable Tile, marks it, and leaves the board unchanged (11.5)', () => {
    const step = exposed.doSteps[0];
    const state = createDoStepState(step);
    const mine = provablyMineTile(state); // the exposed mine is not Provably_Safe
    const before = new Set(state.game.revealed);

    const result = reveal(state, mine);
    expect(result.message).toBe(NOT_PROVABLE_MESSAGE);
    expect(result.state.markedTile).toEqual(mine);
    // The board is unchanged: nothing new revealed, the mine still covered.
    expect(result.state.game.revealed).toEqual(before);
    expect(result.state.game.revealed.has(tileKey(mine[0], mine[1]))).toBe(false);
    expect(objectiveMet(result.state)).toBe(false);
  });

  it('clears the marked Tile once a valid Logical_Move is applied', () => {
    const step = exposed.doSteps[0];
    const state = createDoStepState(step);
    const mine = provablyMineTile(state);
    const intercepted = reveal(state, mine).state;
    expect(intercepted.markedTile).not.toBeNull();

    const [tr, tc] = step.targets[0];
    const applied = reveal(intercepted, [tr, tc]).state;
    expect(applied.markedTile).toBeNull();
    expect(applied.game.revealed.has(tileKey(tr, tc))).toBe(true);
  });
});

describe('Do_Step flag rules (Req 11.4, 11.5)', () => {
  it('applies a Flag_Toggle on a Provably_Mine Tile', () => {
    const step = exposed.doSteps[0];
    const state = createDoStepState(step);
    const mine = provablyMineTile(state);
    const result = applyDoStepAction(state, { type: 'Flag_Toggle', tile: mine });
    expect(result.message).toBeNull();
    expect(result.state.game.flags.has(tileKey(mine[0], mine[1]))).toBe(true);
  });

  it('intercepts a flag on a Tile that is not Provably_Mine (11.5)', () => {
    const step = exposed.doSteps[0];
    const state = createDoStepState(step);
    const safe = step.targets[0]; // a Provably_Safe Tile, never a mine
    const result = applyDoStepAction(state, { type: 'Flag_Toggle', tile: safe });
    expect(result.message).toBe(NOT_PROVABLE_MESSAGE);
    expect(result.state.markedTile).toEqual(safe);
    expect(result.state.game.flags.has(tileKey(safe[0], safe[1]))).toBe(false);
  });
});

describe('chord Objective (Req 11.6, 11.8)', () => {
  const step: DoStep = satisfied.doSteps[0];

  it('is a chord Objective in the authored content', () => {
    expect(step.objective).toBe('chord');
    expect(step.chordOn).toBeDefined();
  });

  it('resets the board and asks for a chord when a Target_Tile is revealed with a plain click (11.6)', () => {
    const state = createDoStepState(step);
    const [tr, tc] = step.targets[0];
    const result = reveal(state, [tr, tc]);
    expect(result.message).toBe(USE_CHORD_MESSAGE);
    expect(result.state.wasReset).toBe(true);
    // Reset to the initial state: no Target_Tile revealed.
    for (const [r, c] of step.targets) {
      expect(result.state.game.revealed.has(tileKey(r, c))).toBe(false);
    }
  });

  it('completes the Objective when the chord reveals every Target_Tile', () => {
    let state = createDoStepState(step);
    const chordOn = step.chordOn!;
    const mine = provablyMineTile(state);

    // Flag the one Provably_Mine neighbor, then chord the Number.
    state = applyDoStepAction(state, { type: 'Flag_Toggle', tile: mine }).state;
    const result = applyDoStepAction(state, { type: 'Chord_Click', tile: chordOn });
    expect(result.message).toBeNull();
    state = result.state;

    for (const [r, c] of step.targets) {
      expect(state.game.revealed.has(tileKey(r, c))).toBe(true);
    }
    expect(objectiveMet(state)).toBe(true);
  });
});

describe('every authored Do_Step can be completed through the engine', () => {
  const lessons: Lesson[] = [exposed, satisfied];
  for (const lesson of lessons) {
    for (const [i, step] of lesson.doSteps.entries()) {
      it(`${lesson.id} do step ${i} reaches its Objective`, () => {
        let state = createDoStepState(step);
        if (step.objective === 'chord') {
          // Flag every mine the board forces, then chord.
          for (const mine of state.board.mines) {
            state = applyDoStepAction(state, { type: 'Flag_Toggle', tile: mine }).state;
          }
          state = applyDoStepAction(state, {
            type: 'Chord_Click',
            tile: step.chordOn!,
          }).state;
        } else {
          for (const [r, c] of step.targets) {
            state = reveal(state, [r, c]).state;
          }
        }
        expect(objectiveMet(state)).toBe(true);
      });
    }
  }
});

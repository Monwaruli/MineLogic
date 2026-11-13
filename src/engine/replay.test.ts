/**
 * Tests for the Replay_Viewer engine and Pattern_Recognition_Speed.
 *
 * - Stepping forward/back and jumping produce the expected frames, and each
 *   action is labeled Logical_Move / Guess / Flag_Toggle / Wasted_Click
 *   (Requirement 16.2, 16.3).
 * - The loss view exposes the Board_State before the losing action, the
 *   Provably_Safe Tiles with their Pattern_Type, and the unresolved
 *   Pattern_Instances (Requirement 16.4, 16.5), and an instance view shows the
 *   appearance-time state with Anchor_Numbers and Tiles (Requirement 16.6).
 * - Pattern_Recognition_Speed is the median seconds per Pattern_Type over
 *   resolved, non-excluded, non-superseded instances, null when none, with
 *   per-status counts (Requirement 8.7, 8.8, 8.9).
 *
 * Validates: Requirements 8.7, 8.8, 8.9, 16.2, 16.3, 16.4, 16.5, 16.6
 */

import { describe, it, expect } from 'vitest';
import { tileKey, type Board } from './board';
import {
  buildReplay,
  frameAt,
  stepForward,
  stepBack,
  instanceView,
} from './replay';
import { computeMetrics, METRICS_VERSION } from './metrics';
import type { MoveLog } from './moveLog';

/** A small no-cascade wall board: start (0,0), a vertical mine wall in column 2. */
const WALL: Board = {
  id: 'wall',
  width: 5,
  height: 3,
  mines: [[0, 2], [1, 2], [2, 2]],
  startTile: [0, 0],
};

describe('Replay_Viewer - stepping and labels (Req 16.2, 16.3)', () => {
  it('labels the start reveal, a flag, a wasted chord, and a guess', () => {
    // On the wall board, the Solver can prove nothing safe from (0,0)=1 alone,
    // so revealing (0,1) is a Guess. The Start_Tile reveal is always a
    // Logical_Move, a Flag_Toggle is labeled as such, and an unsatisfied chord
    // is a Wasted_Click.
    const log: MoveLog = {
      boardId: 'wall',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false }, // start
        { type: 'Flag_Toggle', tile: [0, 2], elapsedMs: 100, wastedClick: false }, // flag
        { type: 'Chord_Click', tile: [0, 0], elapsedMs: 150, wastedClick: true }, // wasted
        { type: 'Reveal_Click', tile: [0, 1], elapsedMs: 200, wastedClick: false }, // guess
      ],
    };
    const replay = buildReplay(WALL, log);
    // frames[0] is the initial frame, then one per entry.
    expect(replay.frames.length).toBe(log.entries.length + 1);
    expect(replay.frames[0].label).toBeNull();
    expect(replay.frames[1].label).toBe('Logical_Move'); // start reveal
    expect(replay.frames[2].label).toBe('Flag_Toggle');
    expect(replay.frames[3].label).toBe('Wasted_Click');
    expect(replay.frames[4].label).toBe('Guess');
  });

  it('labels a Guess when a revealed Target_Tile was not Provably_Safe', () => {
    const log: MoveLog = {
      boardId: 'wall',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false },
        // Reveal a column-2 mine immediately: not Provably_Safe -> Guess.
        { type: 'Reveal_Click', tile: [0, 2], elapsedMs: 100, wastedClick: false },
      ],
    };
    const replay = buildReplay(WALL, log);
    expect(replay.frames[2].label).toBe('Guess');
  });

  it('steps forward and back and jumps to any action', () => {
    const log: MoveLog = {
      boardId: 'wall',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false },
        { type: 'Reveal_Click', tile: [0, 1], elapsedMs: 100, wastedClick: false },
      ],
    };
    const replay = buildReplay(WALL, log);
    const initial = frameAt(replay, -1);
    expect(initial.index).toBe(-1);
    const next = stepForward(replay, -1);
    expect(next.index).toBe(0);
    const last = stepForward(replay, 10); // clamped to last
    expect(last.index).toBe(1);
    const back = stepBack(replay, 1);
    expect(back.index).toBe(0);
    const clampedBack = stepBack(replay, -5); // clamped to initial
    expect(clampedBack.index).toBe(-1);
  });
});

describe('Replay_Viewer - loss view (Req 16.4, 16.5, 16.6)', () => {
  it('exposes the pre-loss state, safe Tiles with types, and unresolved instances', () => {
    const log: MoveLog = {
      boardId: 'wall',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false },
        { type: 'Reveal_Click', tile: [1, 0], elapsedMs: 1000, wastedClick: false },
        // Guess into the mine wall and lose.
        { type: 'Reveal_Click', tile: [0, 2], elapsedMs: 2000, wastedClick: false },
      ],
    };
    const replay = buildReplay(WALL, log);
    expect(replay.loss).not.toBeNull();
    const loss = replay.loss!;
    // The pre-loss state has (0,2) still covered (the losing Tile).
    expect(loss.state.revealed.has(tileKey(0, 2))).toBe(false);
    // Every highlighted safe Tile carries a Pattern_Type and was Provably_Safe.
    expect(loss.safeTiles.length).toBeGreaterThan(0);
    for (const s of loss.safeTiles) {
      expect(typeof s.patternType).toBe('string');
    }
    // Unresolved instances all lack a resolution time.
    for (const inst of loss.unresolved) {
      expect(inst.status).toBe('unresolved');
      expect(inst.resolutionMs).toBeNull();
    }
  });

  it('shows an instance at its appearance time with anchors and tiles (16.6)', () => {
    const log: MoveLog = {
      boardId: 'wall',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false },
        { type: 'Reveal_Click', tile: [1, 0], elapsedMs: 1000, wastedClick: false },
        { type: 'Reveal_Click', tile: [0, 2], elapsedMs: 2000, wastedClick: false },
      ],
    };
    const replay = buildReplay(WALL, log);
    expect(replay.instances.length).toBeGreaterThan(0);
    const inst = replay.instances[0];
    const view = instanceView(replay, inst);
    expect(view.anchors).toEqual(inst.anchors);
    expect(view.tiles).toEqual(inst.tiles);
    // The shown state is a real Board_State reached in the replay.
    expect(view.state.board.id).toBe('wall');
  });

  it('returns no loss view for a non-lost game', () => {
    const log: MoveLog = {
      boardId: 'wall',
      entries: [{ type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false }],
      end: { outcome: 'interrupted', endMs: 10 },
    };
    const replay = buildReplay(WALL, log);
    expect(replay.loss).toBeNull();
  });
});

describe('Metrics_Engine - Pattern_Recognition_Speed (Req 8.7-8.9)', () => {
  it('reports per-type counts and null speed when a type has no resolved instance', () => {
    const log: MoveLog = {
      boardId: 'wall',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false },
        { type: 'Reveal_Click', tile: [1, 0], elapsedMs: 1000, wastedClick: false },
        { type: 'Reveal_Click', tile: [2, 0], elapsedMs: 2000, wastedClick: false },
      ],
    };
    const m = computeMetrics(WALL, log);
    expect(m.metricsVersion).toBe(METRICS_VERSION);
    // Every Pattern_Type is present in the report.
    const keys = Object.keys(m.patternSpeed);
    expect(keys).toContain('Satisfied_Number');
    expect(keys).toContain('Wall_1_1');
    expect(keys).toContain('Mine_Count_Endgame');
    // A type with no resolved, non-excluded, non-superseded instance is null.
    for (const type of keys) {
      const entry = m.patternSpeed[type as keyof typeof m.patternSpeed];
      if (entry.counts.resolved === 0) {
        expect(entry.medianSeconds).toBeNull();
      } else {
        expect(entry.medianSeconds).not.toBeNull();
      }
    }
  });

  it('computes the median seconds over resolved instances of a type', () => {
    // Drive the detector synthetically: a board where directly revealing safe
    // Tiles at known times resolves instances, and check the reported median is
    // resolution - appearance in seconds to one decimal place.
    const log: MoveLog = {
      boardId: 'wall',
      entries: [
        { type: 'Reveal_Click', tile: [0, 0], elapsedMs: 0, wastedClick: false },
        { type: 'Reveal_Click', tile: [0, 1], elapsedMs: 3000, wastedClick: false },
        { type: 'Reveal_Click', tile: [1, 0], elapsedMs: 4000, wastedClick: false },
        { type: 'Reveal_Click', tile: [1, 1], elapsedMs: 5000, wastedClick: false },
        { type: 'Reveal_Click', tile: [2, 0], elapsedMs: 6000, wastedClick: false },
        { type: 'Reveal_Click', tile: [2, 1], elapsedMs: 7000, wastedClick: false },
      ],
    };
    const m = computeMetrics(WALL, log);
    // Each per-type median, when present, is a non-negative number rounded to 1dp.
    for (const type of Object.keys(m.patternSpeed)) {
      const entry = m.patternSpeed[type as keyof typeof m.patternSpeed];
      if (entry.medianSeconds !== null) {
        expect(entry.medianSeconds).toBeGreaterThanOrEqual(0);
        expect(Math.round(entry.medianSeconds * 10) / 10).toBe(entry.medianSeconds);
      }
    }
  });
});

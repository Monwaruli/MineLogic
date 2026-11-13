import { describe, it, expect } from 'vitest';
import {
  loadResults,
  saveResult,
  RESULTS_KEY,
  type GameResultRecord,
  type StorageLike,
} from './gameStorage';
import type { GameMetrics } from '../engine/metrics';

/** A tiny in-memory Storage stub. */
function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const metrics: GameMetrics = {
  metricsVersion: 1,
  boardId: 'gen-1-v1',
  logicalMoveRate: 100,
  logicalMoves: 5,
  countedReveals: 5,
  guesses: 0,
  wrongFlags: 0,
  totalClicks: 7,
  threeBV: 6,
  chordingEfficiency: 1.17,
  clickCounts: { revealClicks: 5, flagToggles: 1, chordClicks: 1, wastedClicks: 0 },
  partial: false,
  excludedForInexact: 0,
  outcome: 'won',
  patternSpeed: {
    Exposed_Mines: { medianSeconds: null, counts: { resolved: 0, excluded: 0, superseded: 0, unresolved: 0 } },
    Satisfied_Number: { medianSeconds: null, counts: { resolved: 0, excluded: 0, superseded: 0, unresolved: 0 } },
    Wall_1_1: { medianSeconds: null, counts: { resolved: 0, excluded: 0, superseded: 0, unresolved: 0 } },
    Wall_1_2_1: { medianSeconds: null, counts: { resolved: 0, excluded: 0, superseded: 0, unresolved: 0 } },
    Wall_1_2_2_1: { medianSeconds: null, counts: { resolved: 0, excluded: 0, superseded: 0, unresolved: 0 } },
    Subset: { medianSeconds: null, counts: { resolved: 0, excluded: 0, superseded: 0, unresolved: 0 } },
    Clue_Chain: { medianSeconds: null, counts: { resolved: 0, excluded: 0, superseded: 0, unresolved: 0 } },
    Mine_Count_Endgame: { medianSeconds: null, counts: { resolved: 0, excluded: 0, superseded: 0, unresolved: 0 } },
  },
};

function record(id: string): GameResultRecord {
  return {
    id,
    difficulty: 'Beginner',
    boardText: 'version 1\nid gen-1-v1\nwidth 9\nheight 9\nmines 10\n',
    moveLogText: 'movelog 1\nboard gen-1-v1\n',
    metrics,
    seed: 1,
    finishedAt: 123,
  };
}

describe('gameStorage', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(loadResults(memoryStorage())).toEqual([]);
  });

  it('saves and loads a result round-trip', () => {
    const store = memoryStorage();
    saveResult(record('a'), store);
    const loaded = loadResults(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe('a');
    expect(loaded[0]!.metrics.chordingEfficiency).toBe(1.17);
  });

  it('appends results in order', () => {
    const store = memoryStorage();
    saveResult(record('a'), store);
    saveResult(record('b'), store);
    expect(loadResults(store).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('stores board and move-log text so metrics can be recomputed later', () => {
    const store = memoryStorage();
    saveResult(record('a'), store);
    const [r] = loadResults(store);
    expect(r!.boardText).toContain('version 1');
    expect(r!.moveLogText).toContain('movelog 1');
  });

  it('reads corrupt storage as empty instead of throwing', () => {
    const store = memoryStorage({ [RESULTS_KEY]: 'not json {{{' });
    expect(loadResults(store)).toEqual([]);
  });

  it('ignores stored values that are not arrays', () => {
    const store = memoryStorage({ [RESULTS_KEY]: '{"foo":1}' });
    expect(loadResults(store)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { buildHubState, type HubStorage } from './hubState';
import { SWEEP_KEY } from '../storage/sweepStorage';

/**
 * Focused test for the Daily_Streak wiring in buildHubState (Req 18.7-18.9).
 * The streak math itself is covered in engine/streak.test.ts; here we only
 * confirm the Hub reads the local completed-Sweep_Days set and the injected
 * clock, so the displayed streak reflects stored completions.
 */
function memoryStorage(initial?: Record<string, string>): HubStorage {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  } as unknown as HubStorage;
}

/** A fixed clock at a given UTC day (noon, to avoid TZ edge cases). */
const at = (day: string) => () => Date.parse(`${day}T12:00:00.000Z`);

describe('buildHubState Daily_Streak wiring', () => {
  it('shows zero streak with no completed Sweep_Days', () => {
    const state = buildHubState(memoryStorage(), at('2024-03-10'));
    expect(state.dailyStreak).toBe(0);
    expect(state.longestStreak).toBe(0);
  });

  it('counts a run ending today', () => {
    const store = memoryStorage({
      [SWEEP_KEY]: JSON.stringify(['2024-03-08', '2024-03-09', '2024-03-10']),
    });
    const state = buildHubState(store, at('2024-03-10'));
    expect(state.dailyStreak).toBe(3);
    expect(state.longestStreak).toBe(3);
  });

  it('counts a run ending yesterday when today is not yet completed', () => {
    const store = memoryStorage({
      [SWEEP_KEY]: JSON.stringify(['2024-03-08', '2024-03-09']),
    });
    const state = buildHubState(store, at('2024-03-10'));
    expect(state.dailyStreak).toBe(2);
  });

  it('reports the longest run even when the current streak is broken', () => {
    const store = memoryStorage({
      [SWEEP_KEY]: JSON.stringify([
        '2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04',
        '2024-03-09',
      ]),
    });
    const state = buildHubState(store, at('2024-03-20'));
    expect(state.dailyStreak).toBe(0);
    expect(state.longestStreak).toBe(4);
  });
});

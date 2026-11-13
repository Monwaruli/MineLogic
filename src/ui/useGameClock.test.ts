import { describe, it, expect } from 'vitest';
import { elapsedMs, formatElapsed } from './useGameClock';

describe('elapsedMs', () => {
  it('is 0 before the start reveal', () => {
    expect(elapsedMs(null, null, 5000)).toBe(0);
  });

  it('counts from the start while running', () => {
    expect(elapsedMs(1000, null, 4500)).toBe(3500);
  });

  it('keeps advancing as now advances (tab hidden then visible)', () => {
    // Simulates a long gap while the tab was hidden: the next read reflects the
    // true wall-clock elapsed, not a count of missed ticks.
    expect(elapsedMs(1000, null, 1000)).toBe(0);
    expect(elapsedMs(1000, null, 61000)).toBe(60000);
  });

  it('freezes at the stop time once stopped', () => {
    expect(elapsedMs(1000, 4000, 99999)).toBe(3000);
  });

  it('never returns a negative span', () => {
    expect(elapsedMs(5000, null, 1000)).toBe(0);
  });
});

describe('formatElapsed', () => {
  it('formats as M:SS', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9000)).toBe('0:09');
    expect(formatElapsed(65000)).toBe('1:05');
    expect(formatElapsed(600000)).toBe('10:00');
  });
});

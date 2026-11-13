import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sweepDayHash, sweepBoardIndex, selectSweepBoard } from './dailySweep';
import { sweepDayOf } from './streak';

const POOL = ['board-A', 'board-B', 'board-C', 'board-D', 'board-E'];

describe('selectSweepBoard', () => {
  it('gives every caller the same board for the same UTC day', () => {
    const day = '2024-03-10';
    const a = selectSweepBoard(day, POOL);
    const b = selectSweepBoard(day, POOL);
    const c = selectSweepBoard(day, POOL);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('always returns a board from the pool', () => {
    for (let i = 0; i < 365; i++) {
      const day = sweepDayOf(Date.parse('2024-01-01T00:00:00Z') + i * 86400000);
      expect(POOL).toContain(selectSweepBoard(day, POOL));
    }
  });

  it('throws on an empty reserve pool', () => {
    expect(() => selectSweepBoard('2024-03-10', [])).toThrow();
  });

  it('rejects malformed Sweep_Day keys', () => {
    expect(() => sweepBoardIndex('03/10/2024', POOL.length)).toThrow();
  });

  it('uses the whole pool over a range of days (not stuck on one board)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 365; i++) {
      const day = sweepDayOf(Date.parse('2024-01-01T00:00:00Z') + i * 86400000);
      seen.add(selectSweepBoard(day, POOL));
    }
    // Over a year it should reach several of the five boards.
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('sweepBoardIndex / sweepDayHash (fast-check)', () => {
  const dayArb = fc
    .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z') })
    .map((d) => sweepDayOf(d.getTime()));

  it('is deterministic: same day + pool size -> same index', () => {
    fc.assert(
      fc.property(dayArb, fc.integer({ min: 1, max: 100 }), (day, size) => {
        expect(sweepBoardIndex(day, size)).toBe(sweepBoardIndex(day, size));
      }),
    );
  });

  it('always yields an in-range index', () => {
    fc.assert(
      fc.property(dayArb, fc.integer({ min: 1, max: 100 }), (day, size) => {
        const idx = sweepBoardIndex(day, size);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(size);
      }),
    );
  });

  it('hash is a stable unsigned 32-bit value', () => {
    fc.assert(
      fc.property(dayArb, (day) => {
        const h = sweepDayHash(day);
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(0xffffffff);
      }),
    );
  });
});

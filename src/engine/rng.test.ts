/**
 * Tests for the seeded PRNG.
 *
 * Covers determinism (same seed -> same stream), range bounds for nextFloat and
 * nextInt, independence of separate instances, and that nextInt rejects bad max
 * values. A property test checks nextInt stays in range across many seeds.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createRng } from './rng';

describe('createRng - determinism', () => {
  it('produces the same uint32 stream for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 50; i++) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it('produces different streams for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const sa = Array.from({ length: 10 }, () => a.nextUint32());
    const sb = Array.from({ length: 10 }, () => b.nextUint32());
    expect(sa).not.toEqual(sb);
  });

  it('coerces equivalent seeds (unsigned 32-bit) to the same stream', () => {
    // -1 >>> 0 === 0xFFFFFFFF, so these seeds must match.
    const a = createRng(-1);
    const b = createRng(0xffffffff);
    for (let i = 0; i < 20; i++) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });
});

describe('createRng - ranges', () => {
  it('nextFloat stays in [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const x = rng.nextFloat();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('nextInt stays in [0, max)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const x = rng.nextInt(10);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(10);
      expect(Number.isInteger(x)).toBe(true);
    }
  });

  it('nextInt(1) is always 0', () => {
    const rng = createRng(3);
    for (let i = 0; i < 20; i++) expect(rng.nextInt(1)).toBe(0);
  });

  it('nextInt rejects non-positive or non-integer max', () => {
    const rng = createRng(1);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-5)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(RangeError);
  });
});

describe('createRng - properties', () => {
  it('nextInt is always within range for any seed and max (Req 5.4)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2_000_000_000, max: 2_000_000_000 }),
        fc.integer({ min: 1, max: 1000 }),
        (seed, max) => {
          const rng = createRng(seed);
          for (let i = 0; i < 20; i++) {
            const x = rng.nextInt(max);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(max);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

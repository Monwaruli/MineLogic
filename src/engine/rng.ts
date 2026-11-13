/**
 * A seeded, deterministic 32-bit PRNG (sfc32).
 *
 * The Board_Generator must be reproducible: the same seed always yields the
 * same stream of numbers, so the same Board. This never calls `Math.random`.
 * It has no React or DOM imports, so it runs in tests, Web Workers, and tools.
 *
 * sfc32 (Simple Fast Counter) keeps four 32-bit words of state and mixes them
 * with adds, rotates, and shifts. It is small, fast, and has good statistical
 * quality for non-cryptographic use. See the Design Notes in tasks.md.
 */

/** A deterministic random-number source. */
export interface Rng {
  /** The next 32-bit unsigned integer. */
  nextUint32(): number;
  /** The next float in the half-open range [0, 1). */
  nextFloat(): number;
  /** A uniform integer in [0, max) for max > 0. Unbiased via rejection. */
  nextInt(max: number): number;
}

/**
 * Hash a single 32-bit seed into four well-mixed state words.
 *
 * Using one user-facing seed keeps the API small while still spreading entropy
 * across all four sfc32 words. This is the splitmix32 mixing step applied four
 * times.
 */
function seedState(seed: number): [number, number, number, number] {
  let s = seed >>> 0;
  const mix = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
  return [mix(), mix(), mix(), mix()];
}

/**
 * Create an sfc32 Rng from a 32-bit seed.
 *
 * The seed is coerced to an unsigned 32-bit integer, so any integer seed is
 * accepted and `createRng(seed)` is fully determined by that value.
 */
export function createRng(seed: number): Rng {
  let [a, b, c, d] = seedState(seed);

  const nextUint32 = (): number => {
    // sfc32 core step.
    const t = (a + b) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) >>> 0;
    const r = (t + d) >>> 0;
    c = (c + r) >>> 0;
    return r >>> 0;
  };

  const nextFloat = (): number => nextUint32() / 0x1_0000_0000;

  const nextInt = (max: number): number => {
    if (max <= 0 || !Number.isInteger(max)) {
      throw new RangeError(`nextInt requires a positive integer max, got ${max}`);
    }
    // Rejection sampling removes modulo bias. `limit` is the largest multiple
    // of `max` that fits in 2^32; draws at or above it are rejected.
    const limit = Math.floor(0x1_0000_0000 / max) * max;
    let x = nextUint32();
    while (x >= limit) x = nextUint32();
    return x % max;
  };

  // Warm up the generator so early outputs are well mixed.
  for (let i = 0; i < 12; i++) nextUint32();

  return { nextUint32, nextFloat, nextInt };
}

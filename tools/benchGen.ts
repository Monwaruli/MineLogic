/**
 * Board_Generator benchmark.
 *
 * Reports generation times per Difficulty so we can check the budgets in
 * Requirement 5.6 (Beginner < 500 ms, Intermediate < 1000 ms, Expert < 3000 ms
 * for at least 90% of Boards). It uses the pure `generate` directly (no Worker)
 * and the seeded PRNG, so the run is deterministic.
 *
 * Run with: npm run bench:gen
 * (which invokes vite-node on this file).
 */

import { DIFFICULTIES, type Difficulty } from '../src/engine/board';
import { generate } from '../src/engine/generator';

/** Number of Boards to generate per Difficulty. */
const SAMPLES: Record<string, number> = {
  Beginner: 30,
  Intermediate: 20,
  Expert: 10,
};

/** The 90th-percentile budget per Difficulty, in milliseconds (Req 5.6). */
const BUDGET_MS: Record<string, number> = {
  Beginner: 500,
  Intermediate: 1000,
  Expert: 3000,
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function benchDifficulty(difficulty: Difficulty, samples: number): void {
  const times: number[] = [];
  let perturbUsed = 0;

  for (let i = 0; i < samples; i++) {
    const seed = 1000 + i;

    // Measure a run with perturbation on (the production path).
    const t0 = performance.now();
    generate(difficulty, seed, { perturb: true });
    const t1 = performance.now();
    times.push(t1 - t0);

    // Separately detect whether this seed needs perturbation to succeed, by
    // trying with perturbation off and a tight attempt cap.
    try {
      generate(difficulty, seed, { perturb: false, maxAttempts: 2000 });
    } catch {
      perturbUsed++;
    }
  }

  times.sort((a, b) => a - b);
  const min = times[0];
  const max = times[times.length - 1];
  const mean = times.reduce((s, x) => s + x, 0) / times.length;
  const p90 = percentile(times, 90);
  const budget = BUDGET_MS[difficulty.name];
  const withinBudget = times.filter((t) => t <= budget).length;
  const pctWithin = (100 * withinBudget) / times.length;

  console.log(`\n${difficulty.name} (${difficulty.width}x${difficulty.height}, ${difficulty.mines} mines) - ${samples} boards`);
  console.log(`  min ${min.toFixed(1)} ms  mean ${mean.toFixed(1)} ms  p90 ${p90.toFixed(1)} ms  max ${max.toFixed(1)} ms`);
  console.log(`  budget ${budget} ms: ${pctWithin.toFixed(0)}% within (need >= 90%)`);
  console.log(`  perturbation needed for ${perturbUsed}/${samples} seeds (perturb-off failed within attempt cap)`);
}

function main(): void {
  console.log('Board_Generator benchmark');
  console.log('=========================');
  for (const difficulty of Object.values(DIFFICULTIES)) {
    benchDifficulty(difficulty, SAMPLES[difficulty.name]);
  }
  console.log('\nDone.');
}

main();

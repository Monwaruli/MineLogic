/**
 * Async wrapper around the Board_Generator.
 *
 * `generateAsync` runs generation off the main thread via a Vite Web Worker so
 * the Board_View keeps responding (Requirement 5.7). It keeps one lazily
 * created Worker and matches replies to requests by id.
 *
 * This file touches the Worker global, so it is a thin bridge, not pure engine
 * logic. When no Worker is available (such as a Node test environment), it
 * falls back to calling the pure `generate` directly, so callers get the same
 * result everywhere. Tests that want the pure path should import `generate`
 * from `generator.ts` instead.
 */

import { generate, type GenerateOptions, type GeneratedBoard } from './generator';
import type { Difficulty } from './board';
import type { GenerateRequest, GenerateResponse } from './generator.worker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (b: GeneratedBoard) => void; reject: (e: Error) => void }
>();

/** True when this environment can host a module Web Worker. */
function workerSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}

/** Lazily create the shared Worker and wire its message handler. */
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./generator.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (event: MessageEvent<GenerateResponse>) => {
    const data = event.data;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error));
  };
  worker.onerror = (event) => {
    // A fatal worker error rejects every outstanding request.
    const err = new Error(event.message || 'Board_Generator worker error');
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };
  return worker;
}

/**
 * Generate a Board asynchronously.
 *
 * Uses a Web Worker when available, otherwise resolves on a microtask using the
 * pure generator. Either way the result is identical for a given
 * `(difficulty, seed, options)`.
 */
export function generateAsync(
  difficulty: Difficulty,
  seed: number,
  options?: GenerateOptions,
): Promise<GeneratedBoard> {
  if (!workerSupported()) {
    // Fallback: no Worker (e.g. Node). Keep it async for a stable contract.
    return Promise.resolve().then(() => generate(difficulty, seed, options));
  }
  const id = nextId++;
  const request: GenerateRequest = { id, difficulty, seed, options };
  return new Promise<GeneratedBoard>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage(request);
  });
}

/** Terminate the shared Worker and reject any outstanding requests. */
export function disposeGeneratorWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const { reject } of pending.values()) {
    reject(new Error('Board_Generator worker disposed'));
  }
  pending.clear();
}

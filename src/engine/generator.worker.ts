/// <reference lib="webworker" />
/**
 * Web Worker entry for the Board_Generator.
 *
 * This is the ONLY file in `src/engine/` allowed to touch worker globals. It is
 * a thin shell: it receives a generation request, calls the pure `generate`
 * from `generator.ts`, and posts the result back. All the real logic stays in
 * the pure module so tests and tools can use it without a Worker.
 *
 * Message in:  GenerateRequest
 * Message out: GenerateResponse (either a GeneratedBoard or an error string),
 *              tagged with the request id so callers can match replies.
 */

import { generate, type GenerateOptions, type GeneratedBoard } from './generator';
import type { Difficulty } from './board';

/** A request posted to the worker. */
export interface GenerateRequest {
  id: number;
  difficulty: Difficulty;
  seed: number;
  options?: GenerateOptions;
}

/** A reply posted from the worker. */
export type GenerateResponse =
  | { id: number; ok: true; result: GeneratedBoard }
  | { id: number; ok: false; error: string };

// `self` is the DedicatedWorkerGlobalScope inside a module worker.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const { id, difficulty, seed, options } = event.data;
  try {
    const result = generate(difficulty, seed, options);
    const response: GenerateResponse = { id, ok: true, result };
    ctx.postMessage(response);
  } catch (err) {
    const response: GenerateResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(response);
  }
};

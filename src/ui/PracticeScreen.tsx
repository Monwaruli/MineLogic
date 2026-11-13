/**
 * Practice screen (task 5): runs one untimed Follow-Along Practice board with
 * the two-stage Nudge.
 *
 * Flow (Requirement 14):
 *  1. Request a No_Guess_Board from generateAsync (Web Worker, with a sync
 *     fallback) and show a progress indicator while it generates. No clock is
 *     shown — practice is untimed (14.1).
 *  2. Route every gesture through the pure practice engine
 *     (`applyPracticeAction`). The engine checks the Solver before applying a
 *     Reveal_Click or revealing Chord_Click and either applies it (all targets
 *     Provably_Safe) or intercepts it and returns a Nudge (14.2, 14.3). Flags
 *     apply unconditionally (14.9).
 *  3. Draw the Nudge as board overlays: the Hint_Region outline at stage 1, plus
 *     the Anchor_Numbers highlights at stage 2 (14.7). A "More Help" control
 *     advances stage 1 to stage 2 (14.4). The engine guarantees a Nudge never
 *     changes the Board_State (14.8), so this component only renders overlays.
 *  4. When the board is cleared, record the completion in local storage and show
 *     the intercepted-action and stage-2 Nudge counts (14.11).
 *
 * All practice rules live in the engine; this component wires input, generation,
 * overlays, and persistence together.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Difficulty } from '../engine/board';
import type { Action } from '../engine/game';
import { generateAsync } from '../engine/generateAsync';
import type { GeneratedBoard } from '../engine/generator';
import {
  applyPracticeAction,
  createPractice,
  requestMoreHelp,
  type PracticeState,
} from '../engine/practice';
import {
  savePracticeCompletion,
  type PracticeCompletionRecord,
  type StorageLike,
} from '../storage/practiceStorage';
import BoardView from './BoardView';

/**
 * The learner-facing hint text, derived from the Nudge stage so the words match
 * what is shown on the board. Stage 1 points to the outlined area; stage 2 names
 * the highlighted numbers (and the mine counter when the deduction needs it).
 * Falls back to the engine `message` when no Nudge is present (e.g. an
 * Inexact_State block).
 */
function hintMessage(
  nudge: PracticeState['nudge'],
  fallback: string,
): string {
  if (!nudge) return fallback;
  if (nudge.stage === 1) {
    return "That move isn't provably safe yet. There's a safe tile in the outlined area — see if you can find it.";
  }
  // Stage 2: the anchor numbers are highlighted on the board.
  return nudge.needsMineCount
    ? 'Use the highlighted numbers and the mine counter (top left) together to find the safe tile.'
    : 'Use the highlighted numbers together to find the safe tile.';
}

export interface PracticeScreenProps {
  difficulty: Difficulty;
  /** Seed for the board. Caller supplies one for deterministic tests. */
  seed: number;
  onHome: () => void;
  onPlayAgain: () => void;
  /** Restart the SAME board (fresh state, identical layout). */
  onRestart?: () => void;
  /** Clock source for finish timestamps; defaults to Date.now. */
  now?: () => number;
  /** Storage for saving completions; defaults to window.localStorage. */
  storage?: StorageLike;
  /** Optional pre-generated board, bypassing generateAsync (for tests). */
  presetBoard?: GeneratedBoard;
}

type Phase = 'generating' | 'playing' | 'done';

export default function PracticeScreen({
  difficulty,
  seed,
  onHome,
  onPlayAgain,
  onRestart,
  now = Date.now,
  storage,
  presetBoard,
}: PracticeScreenProps) {
  const [generated, setGenerated] = useState<GeneratedBoard | null>(presetBoard ?? null);
  const [genError, setGenError] = useState<string | null>(null);
  const [practice, setPractice] = useState<PracticeState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // --- 1. Generate the board (unless one was supplied) ---
  useEffect(() => {
    if (presetBoard) {
      setGenerated(presetBoard);
      return;
    }
    let cancelled = false;
    setGenerated(null);
    setGenError(null);
    generateAsync(difficulty, seed)
      .then((g) => {
        if (!cancelled) setGenerated(g);
      })
      .catch((err: unknown) => {
        if (!cancelled) setGenError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [difficulty, seed, presetBoard]);

  // --- 2. Create the PracticeState once the board is ready ---
  useEffect(() => {
    if (generated) {
      setPractice(createPractice(generated.board));
      setMessage(null);
      setSaved(false);
    }
  }, [generated]);

  const phase: Phase = useMemo(() => {
    if (!generated || !practice) return 'generating';
    if (practice.game.status === 'won') return 'done';
    return 'playing';
  }, [generated, practice]);

  // --- 4. Record the completion once, when the board is cleared ---
  useEffect(() => {
    if (!practice || !generated) return;
    if (practice.game.status !== 'won' || saved) return;
    setSaved(true);
    const record: PracticeCompletionRecord = {
      difficulty: difficulty.name,
      boardId: generated.board.id,
      interceptedCount: practice.interceptedCount,
      stage2Count: practice.stage2Count,
      finishedAt: now(),
    };
    savePracticeCompletion(record, storage);
  }, [practice, generated, saved, difficulty.name, now, storage]);

  const handleAction = useCallback((action: Action) => {
    setPractice((prev) => {
      if (!prev) return prev;
      const result = applyPracticeAction(prev, action);
      setMessage(result.message);
      return result.state;
    });
  }, []);

  const handleMoreHelp = useCallback(() => {
    setPractice((prev) => (prev ? requestMoreHelp(prev) : prev));
  }, []);

  // --- Render ---
  if (genError) {
    return (
      <div className="flex flex-col items-center gap-4" role="alert">
        <p className="text-red-400">Could not generate a board: {genError}</p>
        <button
          type="button"
          onClick={onHome}
          className="px-4 py-2 rounded bg-slate-600 hover:bg-slate-500"
        >
          Home
        </button>
      </div>
    );
  }

  if (phase === 'generating') {
    return (
      <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
        <div
          className="h-10 w-10 rounded-full border-4 border-slate-600 border-t-amber-400 animate-spin"
          aria-hidden="true"
        />
        <p className="text-slate-300">Generating a {difficulty.name} practice board…</p>
      </div>
    );
  }

  const state = practice!;
  const game = state.game;
  const minesLeft = generated!.board.mines.length - game.flags.size;
  const highlightStart = !game.startRevealed;
  const nudge = state.nudge;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center justify-between w-full max-w-[960px] gap-4">
        <div
          className="font-mono text-xl tabular-nums bg-slate-800 px-3 py-1 rounded"
          aria-label={`Mines remaining: ${minesLeft}`}
          data-testid="mine-counter"
        >
          💣 {minesLeft}
        </div>
        <div className="text-sm text-slate-400">{difficulty.name} practice</div>
        <div className="text-sm text-slate-400" data-testid="intercept-count">
          Hints: {state.interceptedCount}
        </div>
      </div>

      {/* In-play controls: leave the level (Home) or start a fresh board. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onHome}
          data-testid="ingame-home"
          className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          ← Home
        </button>
        <button
          type="button"
          onClick={onRestart}
          data-testid="ingame-restart"
          className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          ↺ Restart
        </button>
        <button
          type="button"
          onClick={onPlayAgain}
          data-testid="ingame-newboard"
          className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          ↻ New board
        </button>
      </div>

      {highlightStart && (
        <p className="text-sm text-amber-300" role="note">
          Reveal the highlighted start tile to begin.
        </p>
      )}

      {/* Intercept hint + More Help, shown while a Nudge is up (14.3, 14.4). */}
      {message && (
        <div
          className="flex flex-col items-center gap-2 text-center"
          role="status"
          aria-live="polite"
        >
          <p className="text-amber-300 max-w-md">{hintMessage(nudge, message)}</p>
          {nudge && nudge.stage === 1 && (
            <button
              type="button"
              onClick={handleMoreHelp}
              className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-amber-300"
            >
              More help
            </button>
          )}
        </div>
      )}

      <BoardView
        state={game}
        onAction={handleAction}
        highlightStart={highlightStart}
        overlay={
          nudge
            ? {
                region: nudge.region,
                anchors: nudge.stage === 2 ? nudge.anchors : [],
              }
            : null
        }
      />

      {phase === 'done' && (
        <section
          className="flex flex-col items-center gap-3 bg-slate-800 rounded-lg px-6 py-5 mt-2"
          aria-label="Practice complete"
        >
          <h2 className="text-2xl font-bold text-emerald-400">Board cleared!</h2>
          <p className="text-slate-300 text-center max-w-md">
            You finished this {difficulty.name} practice board with no guesses.
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-slate-400">Intercepted clicks</dt>
            <dd className="text-right font-mono" data-testid="final-intercepts">
              {state.interceptedCount}
            </dd>
            <dt className="text-slate-400">Stage-2 nudges</dt>
            <dd className="text-right font-mono" data-testid="final-stage2">
              {state.stage2Count}
            </dd>
          </dl>
          <div className="flex gap-3 mt-2">
            <button
              type="button"
              onClick={onPlayAgain}
              className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-300"
            >
              Practice again
            </button>
            <button
              type="button"
              onClick={onHome}
              className="px-4 py-2 rounded bg-slate-600 hover:bg-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-300"
            >
              Home
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

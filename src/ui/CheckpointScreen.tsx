/**
 * Mastery_Checkpoint screen (task 7.2): the unassisted test at the end of each
 * Difficulty's tutorial (Requirement 13), with the Video_Panel beside it
 * (Requirement 12.2, 12.3).
 *
 * Flow:
 *  1. Start a checkpoint over the tier's Checkpoint_Variation pool. One
 *     variation is shown at a time, bare — no Overlays, Nudges, or explanations
 *     (13.1). The Solver is never surfaced to the learner here.
 *  2. Route every gesture through the pure checkpoint engine
 *     (`applyCheckpointAction`). A Logical_Move that clears a variation bumps
 *     the streak and presents the next one (13.2); a Slip (a Guess or a
 *     Wrong_Flag) leaves the board unchanged, flashes an error marker on the
 *     slipped Tile, resets the streak, and presents a fresh variation (13.3).
 *  3. Show the streak as three markers (13.5). On the third consecutive clear
 *     the checkpoint passes (13.4): record it in local storage and show a pass
 *     panel.
 *  4. The Video_Panel sits beside the board on wide viewports (>=1280px) and
 *     below it on narrow ones (12.2, 12.3). The layout switches at Tailwind's
 *     `xl` breakpoint (1280px), matching the requirement's threshold.
 *
 * All checkpoint rules live in the engine; this component wires input, the
 * error-marker flash, the markers, persistence, and layout together.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Tier } from '../content/lessons';
import { variationsForTier } from '../content/checkpoints';
import type { Action } from '../engine/game';
import {
  advanceAfterSlip,
  applyCheckpointAction,
  createCheckpoint,
  seededChooser,
  REQUIRED_STREAK,
  type CheckpointState,
} from '../engine/checkpoint';
import {
  saveCheckpointPassed,
  type StorageLike,
} from '../storage/checkpointStorage';
import BoardView from './BoardView';
import VideoPanel from './VideoPanel';

export interface CheckpointScreenProps {
  /** The tier (Difficulty) whose Mastery_Checkpoint to run. */
  tier: Tier;
  onHome: () => void;
  /** Seed for deterministic variation order; tests supply one. */
  seed?: number;
  /** Clock source for the pass timestamp; defaults to Date.now. */
  now?: () => number;
  /** Storage for saving the pass; defaults to window.localStorage. */
  storage?: StorageLike;
  /** How long the error marker flashes before the next variation (ms). */
  slipFlashMs?: number;
}

export default function CheckpointScreen({
  tier,
  onHome,
  seed = 0,
  now = Date.now,
  storage,
  slipFlashMs = 900,
}: CheckpointScreenProps) {
  const [state, setState] = useState<CheckpointState>(() =>
    createCheckpoint(variationsForTier(tier), seededChooser(seed)),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restart cleanly when the tier changes.
  useEffect(() => {
    setState(createCheckpoint(variationsForTier(tier), seededChooser(seed)));
    setMessage(null);
    setSaved(false);
  }, [tier, seed]);

  // Clear any pending flash timer on unmount.
  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  // --- Record the pass once, when the checkpoint is passed (13.4) ---
  useEffect(() => {
    if (state.passed && !saved) {
      setSaved(true);
      saveCheckpointPassed(tier, now(), storage);
    }
  }, [state.passed, saved, tier, now, storage]);

  const handleAction = useCallback(
    (action: Action) => {
      setState((prev) => {
        const result = applyCheckpointAction(prev, action);
        setMessage(result.message);
        // On a Slip the engine marks the slipped Tile and arms a reset; flash
        // the marker, then present the fresh variation (13.3).
        if (result.state.pendingReset) {
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => {
            setState((s) => advanceAfterSlip(s));
            setMessage(null);
          }, slipFlashMs);
        }
        return result.state;
      });
    },
    [slipFlashMs],
  );

  const game = state.game;
  const minesLeft = game.board.mines.length - game.flags.size;

  // Three streak markers (13.5): filled up to the current streak.
  const markers = Array.from({ length: REQUIRED_STREAK }, (_, i) => i < state.streak);

  // The error marker overlay on the slipped Tile (13.3), shown while a reset is
  // pending. BoardView draws the `error` role with a distinct ring + ✗ + label,
  // so it reads without color (Requirement 2.6).
  const overlay =
    state.pendingReset && state.slippedTile
      ? {
          roles: [
            {
              role: 'error' as const,
              tiles: [state.slippedTile],
              label: 'slip',
            },
          ],
        }
      : null;

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
        <div className="text-sm text-slate-400">{tier} mastery checkpoint</div>
        {/* Three streak markers (13.5). */}
        <div
          className="flex items-center gap-1"
          role="status"
          aria-label={`Consecutive clears: ${state.streak} of ${REQUIRED_STREAK}`}
          data-testid="streak-markers"
        >
          {markers.map((filled, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`inline-block h-4 w-4 rounded-full border ${
                filled
                  ? 'bg-emerald-400 border-emerald-300'
                  : 'bg-transparent border-slate-500'
              }`}
              data-testid={filled ? 'streak-filled' : 'streak-empty'}
            />
          ))}
        </div>
      </div>

      {/* In-progress exit: leave the checkpoint and return to the Hub. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onHome}
          data-testid="checkpoint-exit"
          className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          ← Exit checkpoint
        </button>
      </div>

      {message && (
        <p className="text-amber-300 max-w-md text-center" role="status" aria-live="polite">
          {message}
        </p>
      )}

      {/* Board beside the Video_Panel on wide viewports, stacked on narrow ones
          (12.2, 12.3). The xl breakpoint is 1280px. */}
      <div className="flex flex-col xl:flex-row items-start justify-center gap-6 w-full">
        <div className="flex flex-col items-center gap-3">
          {state.passed ? (
            <section
              className="flex flex-col items-center gap-3 bg-slate-800 rounded-lg px-6 py-5"
              aria-label="Checkpoint passed"
            >
              <h2 className="text-2xl font-bold text-emerald-400">Checkpoint passed!</h2>
              <p className="text-slate-300 text-center max-w-md">
                You cleared three {tier} boards in a row with no slips. You can
                apply these patterns on your own.
              </p>
              <button
                type="button"
                onClick={onHome}
                className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-300"
              >
                Done
              </button>
            </section>
          ) : (
            <BoardView state={game} onAction={handleAction} overlay={overlay} />
          )}
        </div>

        <VideoPanel tier={tier} />
      </div>
    </div>
  );
}

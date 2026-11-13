/**
 * End_Summary (task 4.2): shows a finished game's outcome, elapsed time, and
 * the two headline Game_Metrics — Logical_Move_Rate and Chording_Efficiency —
 * each with a one-sentence plain-language explanation.
 *
 * It takes already-computed GameMetrics (computed by the Metrics_Engine, cached
 * by the GameScreen) so rendering is instant; it does no computation itself.
 */

import type { GameMetrics } from '../engine/metrics';
import { formatElapsed } from './useGameClock';

export interface EndSummaryProps {
  metrics: GameMetrics;
  /** Elapsed milliseconds the game took (Start_Tile reveal to end). */
  elapsedMs: number;
  /** Restart / back-to-home callbacks. */
  onPlayAgain: () => void;
  onHome: () => void;
}

/** Human-readable outcome label. */
function outcomeLabel(outcome: GameMetrics['outcome']): string {
  switch (outcome) {
    case 'won':
      return 'You won';
    case 'lost':
      return 'You lost';
    default:
      return 'Game ended';
  }
}

export default function EndSummary({
  metrics,
  elapsedMs,
  onPlayAgain,
  onHome,
}: EndSummaryProps) {
  const lmr =
    metrics.logicalMoveRate === null ? 'n/a' : `${metrics.logicalMoveRate.toFixed(1)}%`;
  const chord =
    metrics.chordingEfficiency === null
      ? 'n/a'
      : metrics.chordingEfficiency.toFixed(2);

  return (
    <section
      aria-label="Game summary"
      className="flex flex-col gap-5 bg-slate-800 rounded-lg p-6 max-w-md w-full"
    >
      <h2 className="text-2xl font-bold">{outcomeLabel(metrics.outcome)}</h2>

      <dl className="flex flex-col gap-4">
        <div>
          <dt className="font-semibold">Time</dt>
          <dd className="text-slate-300" data-testid="summary-time">
            {formatElapsed(elapsedMs)}
          </dd>
        </div>

        <div>
          <dt className="font-semibold">Logical Move Rate</dt>
          <dd className="text-slate-100 text-lg" data-testid="summary-lmr">
            {lmr}
          </dd>
          <p className="text-sm text-slate-400">
            The share of your reveals that logic alone could prove safe — higher
            means fewer guesses.
          </p>
        </div>

        <div>
          <dt className="font-semibold">Chording Efficiency</dt>
          <dd className="text-slate-100 text-lg" data-testid="summary-chord">
            {chord}
          </dd>
          <p className="text-sm text-slate-400">
            {metrics.outcome === 'won'
              ? 'Your clicks divided by the board’s minimum (3BV) — closer to 1 means fewer wasted clicks.'
              : 'Measured only on games you win, so it is not available here.'}
          </p>
        </div>
      </dl>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onPlayAgain}
          className="px-4 py-2 rounded bg-amber-500 text-slate-900 font-semibold hover:bg-amber-400"
        >
          Play again
        </button>
        <button
          type="button"
          onClick={onHome}
          className="px-4 py-2 rounded bg-slate-600 text-slate-100 font-semibold hover:bg-slate-500"
        >
          Home
        </button>
      </div>
    </section>
  );
}

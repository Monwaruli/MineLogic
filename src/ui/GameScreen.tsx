/**
 * Game screen (task 4.2): orchestrates one timed game.
 *
 * Flow:
 *  1. Request a Board from generateAsync (runs in a Web Worker, with a sync
 *     fallback) and show a progress indicator while it generates.
 *  2. Create a GameState and render the Board_View. The Start_Tile is
 *     highlighted and the engine already ignores every action until the
 *     Start_Tile is revealed, so the UI simply guides the first click.
 *  3. The clock starts when the Start_Tile reveal sets `startRevealedAt`.
 *  4. When the game ends (won/lost), compute Game_Metrics with the
 *     Metrics_Engine, persist the result to localStorage, and show the
 *     End_Summary. Metrics are computed off the render path (a deferred task)
 *     so even an Expert board never blocks the UI; a brief "scoring" state
 *     shows until they are ready.
 *
 * All game rules live in the engine; this component only wires input, timing,
 * generation, metrics, and persistence together.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty } from '../engine/board';
import {
  applyAction,
  createGame,
  type Action,
  type GameState,
} from '../engine/game';
import { generateAsync } from '../engine/generateAsync';
import type { GeneratedBoard } from '../engine/generator';
import { printBoard } from '../engine/boardFormat';
import { computeMetrics, type GameMetrics } from '../engine/metrics';
import { serializeMoveLog, type MoveLog, type GameOutcome } from '../engine/moveLog';
import { saveResult, type GameResultRecord, type StorageLike } from '../storage/gameStorage';
import BoardView from './BoardView';
import EndSummary from './EndSummary';
import { elapsedMs, formatElapsed, useGameClock } from './useGameClock';

export interface GameScreenProps {
  difficulty: Difficulty;
  /** Seed for the board. Caller supplies one for deterministic tests. */
  seed: number;
  onHome: () => void;
  onPlayAgain: () => void;
  /** Restart the SAME board (fresh state, identical layout). */
  onRestart?: () => void;
  /** Clock source; defaults to Date.now. Injectable for tests. */
  now?: () => number;
  /** Storage for saving results; defaults to window.localStorage. */
  storage?: StorageLike;
  /**
   * Optional pre-generated board, bypassing generateAsync. Tests pass a
   * hand-built or fixed-seed board to stay fast and deterministic.
   */
  presetBoard?: GeneratedBoard;
}

/** The screen's phase. */
type Phase = 'generating' | 'playing' | 'scoring' | 'summary';

export default function GameScreen({
  difficulty,
  seed,
  onHome,
  onPlayAgain,
  onRestart,
  now = Date.now,
  storage,
  presetBoard,
}: GameScreenProps) {
  const [generated, setGenerated] = useState<GeneratedBoard | null>(presetBoard ?? null);
  const [genError, setGenError] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [metrics, setMetrics] = useState<GameMetrics | null>(null);
  const savedRef = useRef(false);

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

  // --- 2. Create the GameState once the board is ready ---
  useEffect(() => {
    if (generated) {
      setState(createGame(generated.board, now()));
      setMetrics(null);
      savedRef.current = false;
    }
    // `now` is intentionally read once at creation; it must not re-create the
    // game on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generated]);

  const phase: Phase = useMemo(() => {
    if (!generated || !state) return 'generating';
    if (state.status === 'won' || state.status === 'lost') {
      return metrics ? 'summary' : 'scoring';
    }
    return 'playing';
  }, [generated, state, metrics]);

  // --- 3. Clock ---
  const startedAt = state?.startRevealedAt ?? null;
  // Freeze the clock the moment the game ends (use the last move's time).
  const stoppedAt =
    state && (state.status === 'won' || state.status === 'lost') && startedAt !== null
      ? startedAt + lastEntryElapsed(state)
      : null;
  const clockMs = useGameClock({ startedAt, stoppedAt, now });

  // --- 4. On end: compute metrics off the render path, then persist ---
  useEffect(() => {
    if (!state || !generated) return;
    if (state.status !== 'won' && state.status !== 'lost') return;
    if (metrics) return;

    let cancelled = false;
    // Defer so the loss/win frame paints before any heavier metrics work.
    const handle = setTimeout(() => {
      if (cancelled) return;
      const log = buildMoveLog(generated, state);
      const m = computeMetrics(generated.board, log);
      setMetrics(m);

      if (!savedRef.current) {
        savedRef.current = true;
        const record: GameResultRecord = {
          id: `${generated.board.id}-${now()}`,
          difficulty: difficulty.name,
          boardText: printBoard(generated.board),
          moveLogText: serializeMoveLog(log),
          metrics: m,
          seed: generated.metadata.seed,
          finishedAt: now(),
        };
        saveResult(record, storage);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [state, generated, metrics, difficulty.name, now, storage]);

  const handleAction = useCallback(
    (action: Action) => {
      setState((prev) => (prev ? applyAction(prev, action, now()) : prev));
    },
    [now],
  );

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
      <div
        className="flex flex-col items-center gap-4"
        role="status"
        aria-live="polite"
      >
        <div
          className="h-10 w-10 rounded-full border-4 border-slate-600 border-t-amber-400 animate-spin"
          aria-hidden="true"
        />
        <p className="text-slate-300">Generating a {difficulty.name} board…</p>
      </div>
    );
  }

  // state is defined from here on.
  const game = state!;
  const minesLeft = generated!.board.mines.length - game.flags.size;
  const highlightStart = !game.startRevealed;

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
        <div className="text-sm text-slate-400">{difficulty.name}</div>
        <div
          className="font-mono text-xl tabular-nums bg-slate-800 px-3 py-1 rounded"
          aria-label={`Elapsed time: ${formatElapsed(clockMs)}`}
          data-testid="clock"
        >
          ⏱ {formatElapsed(clockMs)}
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

      <BoardView state={game} onAction={handleAction} highlightStart={highlightStart} />

      {phase === 'scoring' && (
        <p className="text-slate-400" role="status" aria-live="polite">
          Scoring your game…
        </p>
      )}

      {phase === 'summary' && metrics && (
        <EndSummary
          metrics={metrics}
          elapsedMs={elapsedMs(startedAt, stoppedAt, now())}
          onPlayAgain={onPlayAgain}
          onHome={onHome}
        />
      )}
    </div>
  );
}

/** Elapsed ms of the last Move_Log entry, used to freeze the clock at game end. */
function lastEntryElapsed(state: GameState): number {
  const entries = state.moveLog;
  if (entries.length === 0) return 0;
  return entries[entries.length - 1]!.elapsedMs;
}

/**
 * Build a Move_Log from the finished GameState: the Board id, the engine's
 * Move_Log entries, and an End_Entry with the outcome and end time.
 */
function buildMoveLog(generated: GeneratedBoard, state: GameState): MoveLog {
  const outcome: GameOutcome = state.status === 'won' ? 'won' : 'lost';
  const endMs = lastEntryElapsed(state);
  return {
    boardId: generated.board.id,
    entries: state.moveLog,
    end: { outcome, endMs },
  };
}

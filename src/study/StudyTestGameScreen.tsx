/**
 * Pre_Test / Post_Test game screen (task 9.2, Requirement 22.8-22.11).
 *
 * Plays a FIXED Evaluation_Board (parsed from Board_Format text) as a
 * Timed_Game with EXACTLY ONE attempt: there is NO restart and NO new-board
 * control (22.8), unlike the normal GameScreen. A time cap applies (22.9/22.10);
 * when it is reached the game ends Timed_Out and the Game_Metrics are computed
 * from the actions made before the cap. On end the screen shows ONLY the
 * outcome and the elapsed time (22.11) — never the full End_Summary / metrics —
 * before the participant continues to the next step.
 *
 * Interruption (22.12) is handled by the Study_Module via a persisted
 * "test in progress" marker: this screen only reports a normal end. The marker
 * write/clear is done by the parent so a reload between screens is covered too.
 *
 * All game rules and metrics come from the shared engine and Metrics_Engine —
 * the task requires test games use the same Metrics_Engine as every other game.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Board } from '../engine/board';
import { applyAction, type Action, type GameState } from '../engine/game';
import type { GameMetrics } from '../engine/metrics';
import { serializeMoveLog } from '../engine/moveLog';
import BoardView from '../ui/BoardView';
import { elapsedMs, formatElapsed, useGameClock } from '../ui/useGameClock';
import type { Tier } from '../content/lessons';
import {
  buildTestMoveLog,
  computeTestMetrics,
  createTestGame,
  resolveTimeCapMs,
  studyOutcomeOf,
  type StudyGameOutcome,
} from './studyTestGame';

/** The result of a finished test game, reported to the parent (22.9, 25.1). */
export interface TestGameResult {
  outcome: StudyGameOutcome;
  /** Elapsed ms from the Start_Tile reveal to the end (cap/win/loss). */
  elapsedMs: number;
  metrics: GameMetrics;
  boardId: string;
  /** The serialized Move_Log, threaded through for study logging (25.1). */
  moveLog: string;
}

export interface StudyTestGameScreenProps {
  /** The parsed Evaluation_Board to play (fixed; never generated). */
  board: Board;
  /** The board's Difficulty, for the default time cap (22.10). */
  tier: Tier;
  /** The Study_Config's cap for this Difficulty in ms, or null/undefined. */
  configuredCapMs?: number | null;
  /** Called once when the game ends (won / lost / Timed_Out). */
  onFinished: (result: TestGameResult) => void;
  /** Clock source; defaults to Date.now. Injectable for tests. */
  now?: () => number;
  /** A short controls reminder (22.7) shown above the board, optional. */
  controlsReminder?: string;
}

export default function StudyTestGameScreen({
  board,
  tier,
  configuredCapMs,
  onFinished,
  now = Date.now,
  controlsReminder,
}: StudyTestGameScreenProps) {
  const capMs = useMemo(() => resolveTimeCapMs(tier, configuredCapMs), [tier, configuredCapMs]);

  const [state, setState] = useState<GameState>(() => createTestGame(board, now()));
  const [ended, setEnded] = useState<{ outcome: StudyGameOutcome; elapsedMs: number } | null>(null);
  const reportedRef = useRef(false);

  const startedAt = state.startRevealedAt;

  // Freeze the clock at game end: last action time for win/loss, cap for Timed_Out.
  const stoppedAt = useMemo(() => {
    if (!ended || startedAt === null) return null;
    return startedAt + ended.elapsedMs;
  }, [ended, startedAt]);

  const clockMs = useGameClock({ startedAt, stoppedAt, now });

  // Decide and report the end exactly once.
  const finish = useCallback(
    (outcome: StudyGameOutcome, endElapsedMs: number) => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      setEnded({ outcome, elapsedMs: endElapsedMs });
      const log = buildTestMoveLog(board, state, outcome, endElapsedMs);
      const metrics = computeTestMetrics(board, log);
      onFinished({
        outcome,
        elapsedMs: endElapsedMs,
        metrics,
        boardId: board.id,
        moveLog: serializeMoveLog(log),
      });
    },
    [board, state, onFinished],
  );

  // Win/loss ends the game at the last action's time.
  useEffect(() => {
    if (ended) return;
    const outcome = studyOutcomeOf(state);
    if (outcome === 'won' || outcome === 'lost') {
      const lastMs = state.moveLog.length
        ? state.moveLog[state.moveLog.length - 1]!.elapsedMs
        : 0;
      finish(outcome, lastMs);
    }
  }, [state, ended, finish]);

  // Time cap (22.9/22.10): once started, end Timed_Out when the live elapsed
  // reaches the cap. Checked against the wall clock so a hidden tab still times
  // out on return.
  useEffect(() => {
    if (ended || startedAt === null) return;
    const check = () => {
      const el = elapsedMs(startedAt, null, now());
      if (el >= capMs) finish('Timed_Out', capMs);
    };
    check();
    const id = setInterval(check, 250);
    return () => clearInterval(id);
  }, [ended, startedAt, capMs, now, finish]);

  const handleAction = useCallback(
    (action: Action) => {
      if (reportedRef.current) return; // one attempt only — no input after end
      setState((prev) => applyAction(prev, action, now()));
    },
    [now],
  );

  const panel = 'w-full flex flex-col items-center gap-4';

  if (ended) {
    // 22.11 — show ONLY the outcome and the elapsed time, never full metrics.
    const label =
      ended.outcome === 'won'
        ? 'Cleared'
        : ended.outcome === 'lost'
          ? 'Hit a mine'
          : ended.outcome === 'Timed_Out'
            ? 'Time ran out'
            : 'Interrupted';
    return (
      <section className={panel} data-testid="study-test-ended">
        <h2 className="text-lg font-semibold">This board is done</h2>
        <p className="text-slate-300" data-testid="study-test-outcome">
          Outcome: <span className="font-medium">{label}</span>
        </p>
        <p className="text-slate-300" data-testid="study-test-elapsed">
          Time: {formatElapsed(ended.elapsedMs)}
        </p>
      </section>
    );
  }

  const highlightStart = !state.startRevealed;
  const minesLeft = board.mines.length - state.flags.size;

  return (
    <section className={panel} data-testid="study-test-playing">
      <div className="flex items-center justify-between w-full max-w-[960px] gap-4">
        <div
          className="font-mono text-xl tabular-nums bg-slate-800 px-3 py-1 rounded"
          aria-label={`Mines remaining: ${minesLeft}`}
          data-testid="study-test-mine-counter"
        >
          💣 {minesLeft}
        </div>
        <div className="text-sm text-slate-400">{tier} test board</div>
        <div
          className="font-mono text-xl tabular-nums bg-slate-800 px-3 py-1 rounded"
          aria-label={`Elapsed time: ${formatElapsed(clockMs)}`}
          data-testid="study-test-clock"
        >
          ⏱ {formatElapsed(clockMs)}
        </div>
      </div>

      {controlsReminder && (
        <p className="text-sm text-amber-300" role="note" data-testid="study-test-controls">
          {controlsReminder}
        </p>
      )}

      {highlightStart && (
        <p className="text-sm text-amber-300" role="note">
          Reveal the highlighted start tile to begin. You get one attempt — there
          is no restart.
        </p>
      )}

      <BoardView state={state} onAction={handleAction} highlightStart={highlightStart} />
    </section>
  );
}

/**
 * Tutorial_Player (task 7.1): runs one Learn-Then-Do Lesson.
 *
 * Flow (Requirement 11):
 *  1. Learn_Steps come first. Each shows a demonstration Mini_Board with
 *     labeled, colored Overlays on the interacting Numbers and on the Tiles
 *     those Numbers prove safe or mine, plus the explanation (11.2). The learner
 *     steps through them with Back / Next.
 *  2. Do_Steps follow, each on its own 5x5 Mini_Board (11.3). Every gesture is
 *     routed through the pure Tutorial_Player engine (`applyDoStepAction`):
 *      - A Logical_Move, or a flag on a Provably_Mine Tile, is applied (11.4).
 *      - A reveal of a non-provable Tile, or a flag on a non-mine Tile, is left
 *        unapplied; the attempted Tile is marked with an error Overlay and a
 *        message explains it cannot yet be proven (11.5).
 *      - A chord-Objective step revealed with a plain click resets the board and
 *        asks for a chord (11.6).
 *  3. The Next control stays disabled until the current Do_Step's Objective is
 *     met (11.7); meeting it marks the step complete and enables Next (11.8).
 *  4. Completing the last Do_Step records the Lesson complete (11.9). Reopening a
 *     partly done Lesson resumes at the first incomplete Do_Step (11.10), read
 *     from local storage.
 *
 * All Do_Step rules live in the engine; this component wires input, Overlays,
 * step navigation, and progress persistence together. The Solver work the engine
 * does is identical to Follow-Along Practice and the Metrics_Engine, so the
 * tutorial's notion of "provable" matches the rest of the app.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Action } from '../engine/game';
import { parseBoard } from '../engine/boardFormat';
import {
  applyDoStepAction,
  createDoStepState,
  objectiveMet,
  type DoStepState,
} from '../engine/tutorial';
import type { Lesson, LearnStep, OverlayRole } from '../content/lessons';
import {
  resumeDoStepIndex,
  saveLessonProgress,
  type StorageLike,
} from '../storage/lessonStorage';
import BoardView, {
  type BoardRoleOverlay,
  type OverlayTileRole,
} from './BoardView';

export interface TutorialPlayerProps {
  lesson: Lesson;
  onHome: () => void;
  /** Called when the learner completes the Lesson's last Do_Step (11.9). */
  onComplete?: () => void;
  /** Storage for Lesson progress; defaults to window.localStorage. */
  storage?: StorageLike;
  /** Clock for progress timestamps; defaults to Date.now. */
  now?: () => number;
}

/** The two phases of a Lesson: reading Learn_Steps, then doing Do_Steps. */
type Phase = 'learn' | 'do';

/** Map a Learn_Step Overlay role to the BoardView Tile-overlay role. */
function overlayRole(role: OverlayRole): OverlayTileRole {
  return role; // 'clue' | 'safe' | 'mine' share names with BoardView roles
}

/** Build the role overlays for a Learn_Step's demonstration board (11.2). */
function learnOverlays(step: LearnStep): BoardRoleOverlay[] {
  return step.overlays.map((o) => ({
    role: overlayRole(o.role),
    tiles: o.tiles,
    label: o.label,
  }));
}

export default function TutorialPlayer({
  lesson,
  onHome,
  onComplete,
  storage,
  now = Date.now,
}: TutorialPlayerProps) {
  const doStepCount = lesson.doSteps.length;

  // Resume point: the first incomplete Do_Step (11.10). When the Lesson is
  // already complete this is doStepCount; we then start the learner on the last
  // Do_Step for review rather than an out-of-range index.
  const resumeIndex = useMemo(
    () => resumeDoStepIndex(lesson.id, doStepCount, storage),
    [lesson.id, doStepCount, storage],
  );

  // If there is saved progress into the Do_Steps, skip the Learn_Steps and go
  // straight to the resume point; otherwise start at the first Learn_Step.
  const [phase, setPhase] = useState<Phase>(resumeIndex > 0 ? 'do' : 'learn');
  const [learnIndex, setLearnIndex] = useState(0);
  const [doIndex, setDoIndex] = useState(
    Math.min(resumeIndex, Math.max(0, doStepCount - 1)),
  );
  const [doState, setDoState] = useState<DoStepState>(() =>
    createDoStepState(lesson.doSteps[Math.min(resumeIndex, doStepCount - 1)]),
  );
  const [message, setMessage] = useState<string | null>(null);

  // Rebuild the Do_Step engine state whenever the active Do_Step changes.
  useEffect(() => {
    if (phase === 'do') {
      setDoState(createDoStepState(lesson.doSteps[doIndex]));
      setMessage(null);
    }
  }, [phase, doIndex, lesson.doSteps]);

  const objDone = phase === 'do' ? objectiveMet(doState) : false;

  // Persist progress whenever a Do_Step's Objective is first met (11.8, 11.9).
  useEffect(() => {
    if (phase !== 'do' || !objDone) return;
    // completedDoSteps counts Do_Steps finished: this step's index + 1.
    saveLessonProgress(lesson.id, doIndex + 1, doStepCount, now(), storage);
  }, [phase, objDone, doIndex, doStepCount, lesson.id, now, storage]);

  const handleAction = useCallback(
    (action: Action) => {
      setDoState((prev) => {
        const result = applyDoStepAction(prev, action);
        setMessage(result.message);
        return result.state;
      });
    },
    [],
  );

  // --- Learn_Step navigation ---
  const learnStep = lesson.learnSteps[learnIndex];
  const learnBoard = useMemo(
    () => (phase === 'learn' ? parseBoard(learnStep.boardText) : null),
    [phase, learnStep],
  );

  const goNextLearn = useCallback(() => {
    if (learnIndex < lesson.learnSteps.length - 1) {
      setLearnIndex((i) => i + 1);
    } else {
      setPhase('do');
      setDoIndex(0);
    }
  }, [learnIndex, lesson.learnSteps.length]);

  const goBackLearn = useCallback(() => {
    setLearnIndex((i) => Math.max(0, i - 1));
  }, []);

  // --- Do_Step navigation ---
  const isLastDo = doIndex >= doStepCount - 1;

  const goNextDo = useCallback(() => {
    if (!objectiveMet(doState)) return; // Next stays disabled until met (11.7)
    if (isLastDo) {
      saveLessonProgress(lesson.id, doStepCount, doStepCount, now(), storage);
      onComplete?.();
      return;
    }
    setDoIndex((i) => i + 1);
  }, [doState, isLastDo, lesson.id, doStepCount, now, storage, onComplete]);

  const goBackDo = useCallback(() => {
    if (doIndex === 0) {
      setPhase('learn');
      setLearnIndex(lesson.learnSteps.length - 1);
    } else {
      setDoIndex((i) => i - 1);
    }
  }, [doIndex, lesson.learnSteps.length]);

  // ----- Render -----
  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[640px]">
      <header className="w-full flex items-center justify-between">
        <button
          type="button"
          onClick={onHome}
          data-testid="tutorial-exit"
          className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          ← Exit tutorial
        </button>
        <span className="text-xs uppercase tracking-wide text-slate-500">
          {lesson.tier} tutorial
        </span>
      </header>

      <h1 className="text-2xl font-bold text-slate-100 text-center">{lesson.title}</h1>
      <p className="text-slate-400 text-center text-sm">{lesson.summary}</p>

      {phase === 'learn' && learnBoard && (
        <section
          className="flex flex-col items-center gap-4 w-full"
          aria-label={`Learn step ${learnIndex + 1} of ${lesson.learnSteps.length}`}
        >
          <p className="text-xs text-slate-500" data-testid="learn-progress">
            Learn {learnIndex + 1} / {lesson.learnSteps.length}
          </p>
          <BoardView
            state={{
              board: learnBoard,
              revealed: new Set(
                (learnBoard.initialRevealed ?? []).map(([r, c]) => `${r},${c}`),
              ),
              flags: new Set<string>(),
              status: 'playing',
              startRevealed: true,
              startRevealedAt: 0,
              moveLog: [],
            }}
            // Learn_Steps are read-only demonstrations: swallow every gesture.
            onAction={() => {}}
            overlay={{ roles: learnOverlays(learnStep) }}
          />
          <p className="text-slate-200 text-center max-w-prose" data-testid="learn-explanation">
            {learnStep.explanation}
          </p>
          {/* Overlay legend reads without color (Requirement 2.6). */}
          <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-400">
            {learnStep.overlays.map((o, idx) => (
              <li key={idx}>
                <span className="font-semibold text-slate-200">{o.role}</span>: {o.label}
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={goBackLearn}
              disabled={learnIndex === 0}
              className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              Back
            </button>
            <button
              type="button"
              onClick={goNextLearn}
              data-testid="learn-next"
              className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-300"
            >
              {learnIndex < lesson.learnSteps.length - 1 ? 'Next' : 'Start practicing'}
            </button>
          </div>
        </section>
      )}

      {phase === 'do' && (
        <section
          className="flex flex-col items-center gap-4 w-full"
          aria-label={`Do step ${doIndex + 1} of ${doStepCount}`}
        >
          <p className="text-xs text-slate-500" data-testid="do-progress">
            Practice {doIndex + 1} / {doStepCount}
          </p>
          <p className="text-slate-200 text-center max-w-prose" data-testid="do-prompt">
            {doState.step.prompt}
          </p>

          <BoardView
            state={doState.game}
            onAction={handleAction}
            overlay={
              doState.markedTile
                ? {
                    roles: [
                      {
                        role: 'error',
                        tiles: [doState.markedTile],
                        label: 'cannot be proven yet',
                      },
                    ],
                  }
                : null
            }
          />

          {message && (
            <p className="text-amber-300 text-center max-w-prose" role="status" aria-live="polite">
              {message}
            </p>
          )}

          {objDone && (
            <p className="text-emerald-400 font-semibold" role="status" data-testid="do-complete">
              Nice — objective complete.
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={goBackDo}
              className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              Back
            </button>
            <button
              type="button"
              onClick={goNextDo}
              disabled={!objDone}
              data-testid="do-next"
              className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 font-semibold disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-300"
            >
              {isLastDo ? 'Finish lesson' : 'Next'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

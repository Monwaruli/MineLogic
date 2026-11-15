/**
 * Study_Session step router (task 9.2, Requirements 22 and 23).
 *
 * Owns the in-session flow once a Participant has consented (or resumed). It
 * runs the Study_Session steps in the fixed order (22.1):
 *
 *   Background_Questions -> Pre_Test -> Learning_Phase -> Post_Test
 *   -> Survey_Form -> completion
 *
 * and shows navigation only for the current step (22.2). As each step
 * completes it is marked complete in the LOCAL Study_Session pointer
 * (markStepComplete) so a same-browser reopen resumes at the first incomplete
 * step (22.1, 21.9). The detailed Study_Record writes are task 9.3.
 *
 * Pre_Test (22.3): Pre_Beginner then Pre_Intermediate.
 * Post_Test (22.4): Post_Beginner then Post_Intermediate, and Post_Expert after
 * Post_Intermediate only when the Study_Config includes the Expert tier.
 *
 * Each test game is a Timed_Game with one attempt played on a FIXED
 * Evaluation_Board (StudyTestGameScreen). On mount of a test game a
 * "test in progress" marker is written; on normal end it is cleared. If the
 * page is reloaded/closed mid-game, the marker survives and the Study_Module
 * records the game Interrupted on the next load (22.12) before entering this
 * router at the next step.
 *
 * Background_Questions and Survey_Form are minimal placeholders that advance the
 * step (their full content/logging is task 9.3). The Resume_Code is shown on
 * the completion screen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Tier } from '../content/lessons';
import type { StudyConfig, StudyGroup } from './studyService';
import { FINAL_STEP, STUDY_STEPS, stepIndex, type StudyStep } from './steps';
import {
  markStepComplete,
  saveTestMarker,
  clearTestMarker,
  type StorageLike,
} from './studySessionStorage';
import StudyTestGameScreen, { type TestGameResult } from './StudyTestGameScreen';
import StudyLearningPhase from './StudyLearningPhase';
import SurveyForm from './SurveyForm';
import { parseEvaluationBoard } from './studyTestGame';
import { createStudyLogger, type StudyLogger, type BackgroundAnswers } from './studyLogger';
import { makeStudyDeliver } from './studyLogger';
import { flushQueue } from '../storage/syncQueue';
import { BACKGROUND_QUESTION_IDS } from './csvExport';
import type { Board } from '../engine/board';

/** One Evaluation_Board in a test phase: its role, tier, and Board_Format text. */
interface TestGameSpec {
  role: string;
  tier: Tier;
  board: Board;
}

export interface StudySessionProps {
  studyCode: string;
  participantId: string;
  resumeCode: string;
  config: StudyConfig;
  /** The participant's group from resume, or null (23.5). */
  initialGroup?: StudyGroup | null;
  /** The first incomplete step to start at (21.9/21.10, 22.1). */
  startStep: StudyStep;
  storage?: StorageLike;
  now?: () => number;
  /** Rendered beside each step so the Withdraw control stays available (21.11). */
  withdrawControl?: React.ReactNode;
  /**
   * The Study_Logger used to record Study_Records (24.6, 25). Injectable so
   * tests pass a fake; defaults to a logger wired to the real Sync_Queue, bound
   * to this Participant_ID.
   */
  logger?: StudyLogger;
}

/** The raw (role, tier, text) list for a phase, before parsing. */
interface TestGameSource {
  role: string;
  tier: Tier;
  text: string;
}

/** Ordered Pre_Test sources (22.3). */
function preTestSources(config: StudyConfig): TestGameSource[] {
  const out: TestGameSource[] = [];
  if (config.preBeginner) out.push({ role: 'Pre_Beginner', tier: 'Beginner', text: config.preBeginner });
  if (config.preIntermediate) out.push({ role: 'Pre_Intermediate', tier: 'Intermediate', text: config.preIntermediate });
  return out;
}

/** Ordered Post_Test sources (22.4); Post_Expert only when Expert is included. */
function postTestSources(config: StudyConfig): TestGameSource[] {
  const out: TestGameSource[] = [];
  if (config.postBeginner) out.push({ role: 'Post_Beginner', tier: 'Beginner', text: config.postBeginner });
  if (config.postIntermediate) out.push({ role: 'Post_Intermediate', tier: 'Intermediate', text: config.postIntermediate });
  if (config.includesExpert && config.postExpert) {
    out.push({ role: 'Post_Expert', tier: 'Expert', text: config.postExpert });
  }
  return out;
}

/**
 * Parse each source's Board_Format text into a Board. A board that fails to
 * parse is dropped and its role is collected in `errors`, so the phase can show
 * a configuration error rather than crashing the whole module (defensive; a
 * well-formed Study_Config passes the Content_Validator in validate.ts).
 */
function parseSources(sources: TestGameSource[]): { games: TestGameSpec[]; errors: string[] } {
  const games: TestGameSpec[] = [];
  const errors: string[] = [];
  for (const s of sources) {
    try {
      games.push({ role: s.role, tier: s.tier, board: parseEvaluationBoard(s.text) });
    } catch {
      errors.push(s.role);
    }
  }
  return { games, errors };
}

const CONTROLS_REMINDER =
  'Left-click to reveal a tile. Right-click to flag a suspected mine.';

export default function StudySession({
  studyCode,
  participantId,
  resumeCode,
  config,
  initialGroup = null,
  startStep,
  storage,
  now = Date.now,
  withdrawControl,
  logger,
}: StudySessionProps) {
  const [step, setStep] = useState<StudyStep>(startStep);
  const [group, setGroup] = useState<StudyGroup | null>(initialGroup);

  // The Study_Logger routes every Study_Record through the Sync_Queue (25.10).
  // Bound to this Participant_ID; stable for the session so repeated logs share
  // the same (idempotent) enqueue path.
  const studyLogger = useMemo(
    () => logger ?? createStudyLogger(participantId),
    [logger, participantId],
  );

  // Deliver any enqueued Study_Records to the Backend through the Sync_Queue
  // using the study-specific deliver (insert_study_record RPC, 25.10). The
  // logger only ENQUEUES; without this flush the records would sit in local
  // storage and never reach Supabase. Failures stay queued and retry on the
  // next flush. Fire-and-forget: the UI does not block on delivery.
  const flushStudy = useCallback(() => {
    void flushQueue(makeStudyDeliver(), { storage }).catch(() => {
      // Swallow: a failed delivery remains queued and retries on a later flush.
    });
  }, [storage]);

  const complete = useCallback(
    (done: StudyStep) => {
      // Mark the finished step complete in the LOCAL pointer so a same-browser
      // reopen resumes correctly (22.1, 21.9). The steps run in a fixed linear
      // order (22.1), so advancing means moving to the NEXT step in STUDY_STEPS
      // (not firstIncompleteStep, which would walk back to any earlier step that
      // was skipped when resuming mid-flow).
      markStepComplete(studyCode, done, now(), storage);
      const idx = stepIndex(done);
      const next = idx >= 0 && idx < STUDY_STEPS.length - 1 ? STUDY_STEPS[idx + 1]! : FINAL_STEP;
      setStep(next);
    },
    [studyCode, now, storage],
  );

  const panel = 'w-full max-w-xl bg-slate-800 rounded-xl p-6 flex flex-col gap-4 shadow-lg';

  // Each step shows only its own navigation (22.2), plus the Withdraw control.
  const frame = (testid: string, children: React.ReactNode) => (
    <section className={panel} data-testid={testid}>
      {children}
      {withdrawControl}
    </section>
  );

  if (step === 'Background_Questions') {
    return frame(
      'study-step-background',
      <BackgroundQuestions
        onSubmit={(answers) => {
          // 25.7 — store the Background_Question answers and the group (null
          // here; it is assigned later in the Intermediate block, 23.3).
          studyLogger.logBackground(answers, group);
          flushStudy();
          complete('Background_Questions');
        }}
      />,
    );
  }

  if (step === 'Pre_Test') {
    const { games, errors } = parseSources(preTestSources(config));
    return frame(
      'study-step-pretest',
      <TestPhase
        studyCode={studyCode}
        step="Pre_Test"
        games={games}
        parseErrors={errors}
        storage={storage}
        now={now}
        logger={studyLogger}
        onFlush={flushStudy}
        onPhaseComplete={() => complete('Pre_Test')}
      />,
    );
  }

  if (step === 'Learning_Phase') {
    return frame(
      'study-step-learning',
      <StudyLearningPhase
        participantId={participantId}
        includesExpert={config.includesExpert}
        initialGroup={group}
        intermediateVideoSource={config.intermediateVideoSource}
        onGroupAssigned={setGroup}
        onComplete={() => complete('Learning_Phase')}
        now={now}
      />,
    );
  }

  if (step === 'Post_Test') {
    const { games, errors } = parseSources(postTestSources(config));
    return frame(
      'study-step-posttest',
      <TestPhase
        studyCode={studyCode}
        step="Post_Test"
        games={games}
        parseErrors={errors}
        storage={storage}
        now={now}
        logger={studyLogger}
        onFlush={flushStudy}
        onPhaseComplete={() => complete('Post_Test')}
      />,
    );
  }

  if (step === 'Survey_Form') {
    return frame(
      'study-step-survey',
      <SurveyForm
        ratingItems={config.surveyRatingItems}
        openPrompts={config.surveyOpenPrompts}
        demographicsItem={config.surveyDemographicsItem}
        onSubmit={(answers) => {
          // 24.6 — store every answer (unanswered items as blank) with the
          // Participant_ID (on every record), then show the completion screen.
          studyLogger.logSurvey(answers);
          flushStudy();
          complete('Survey_Form');
        }}
      />,
    );
  }

  // completion — show the Resume_Code (21.8) and the Daily_Sweep invitation for
  // the optional Retention_Window (24.7).
  return frame(
    'study-step-completion',
    <>
      <h1 className="text-xl font-semibold">You’re all done</h1>
      <p className="text-slate-300 text-sm">
        Thank you for taking part. Keep your resume code in case you want to
        return.
      </p>
      <p
        className="text-2xl font-mono tracking-widest text-emerald-300 bg-slate-900 rounded p-3 text-center"
        data-testid="completion-resume-code"
      >
        {resumeCode}
      </p>
      <p className="text-slate-300 text-sm" data-testid="completion-retention-invite">
        Over the next five days, you’re invited to play the Daily Sweep each day
        to keep your streak going. It’s optional, and it helps the study measure
        how the skills stick.
      </p>
    </>,
  );
}

/**
 * The Background_Questions step (Requirement 10.1-style background questions;
 * their answers are logged for the study under 25.7). Two short questions — a
 * self-reported experience level and a goal — matching the Background_Question
 * ids the exporter documents (csvExport.BACKGROUND_QUESTION_IDS). Either may be
 * left blank; the answers are logged on Continue.
 */
function BackgroundQuestions({
  onSubmit,
}: {
  onSubmit: (answers: BackgroundAnswers) => void;
}) {
  const [experience, setExperience] = useState('');
  const [goal, setGoal] = useState('');
  const [qExperience, qGoal] = BACKGROUND_QUESTION_IDS;

  return (
    <>
      <h1 className="text-xl font-semibold">A couple of quick questions</h1>
      <p className="text-slate-300 text-sm">
        A little about your experience before you start. Both are optional.
      </p>
      <label className="flex flex-col gap-1 text-sm text-slate-200">
        How would you describe your Minesweeper experience?
        <select
          className="rounded bg-slate-900 border border-slate-600 p-2 text-slate-100"
          value={experience}
          onChange={(e) => setExperience(e.target.value)}
          data-testid="background-experience"
        >
          <option value="">Prefer not to say</option>
          <option value="new">New to Minesweeper</option>
          <option value="casual">I play casually</option>
          <option value="experienced">I play often</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-200">
        What do you most want to get better at?
        <input
          className="rounded bg-slate-900 border border-slate-600 p-2 text-slate-100"
          value={goal}
          maxLength={200}
          onChange={(e) => setGoal(e.target.value)}
          data-testid="background-goal"
        />
      </label>
      <button
        className="self-start px-4 py-2 rounded bg-sky-600 text-white"
        onClick={() => onSubmit({ [qExperience!]: experience, [qGoal!]: goal })}
        data-testid="background-continue"
      >
        Continue
      </button>
    </>
  );
}

/**
 * Runs the ordered test games of one phase (Pre_Test or Post_Test), one at a
 * time, then calls onPhaseComplete. Writes/clears the in-progress marker around
 * each game so an interruption is recoverable (22.12).
 */
function TestPhase({
  studyCode,
  step,
  games,
  parseErrors = [],
  storage,
  now,
  logger,
  onFlush,
  onPhaseComplete,
}: {
  studyCode: string;
  step: StudyStep;
  games: TestGameSpec[];
  parseErrors?: string[];
  storage?: StorageLike;
  now: () => number;
  logger: StudyLogger;
  onFlush: () => void;
  onPhaseComplete: () => void;
}) {
  const [index, setIndex] = useState(0);
  const current = games[index];

  // Write the in-progress marker whenever a test game is on screen (22.12).
  useEffect(() => {
    if (!current) return;
    saveTestMarker(
      {
        studyCode,
        step,
        tier: current.tier,
        boardId: current.board.id,
        gameIndex: index,
      },
      now(),
      storage,
    );
    // Marker is cleared on normal end (in onFinished) or by withdrawal/decline.
  }, [current, studyCode, step, index, now, storage]);

  // When no games are configured/parseable for this phase, complete so the
  // flow does not dead-end (a well-formed Study_Config always has games).
  useEffect(() => {
    if (games.length === 0) onPhaseComplete();
  }, [games.length, onPhaseComplete]);

  const handleFinished = useCallback(
    (result: TestGameResult) => {
      // 25.1 — log the finished test game through the Study_Logger (participant
      // id, phase, Difficulty, board id, outcome, elapsed ms, Game_Metrics,
      // Metrics_Version, serialized Move_Log). The write goes via the Sync_Queue
      // with a stable id, so re-finishing the same board does not duplicate it.
      if (current) {
        logger.logTestGame({
          phase: step === 'Post_Test' ? 'Post_Test' : 'Pre_Test',
          tier: current.tier,
          outcome: result.outcome,
          elapsedMs: result.elapsedMs,
          metrics: result.metrics,
          boardId: result.boardId,
          moveLog: result.moveLog,
        });
        // Deliver the just-logged record to the Backend (25.10).
        onFlush();
      }
      // Normal end: clear the marker (not an interruption).
      clearTestMarker(studyCode, storage);
      if (index >= games.length - 1) {
        onPhaseComplete();
      } else {
        setIndex((i) => i + 1);
      }
    },
    [studyCode, storage, index, games.length, onPhaseComplete, logger, step, current, onFlush],
  );

  const reminder = useMemo(() => (step === 'Pre_Test' ? CONTROLS_REMINDER : undefined), [step]);

  if (!current) {
    // No parseable games: show a brief notice (defensive) while the effect
    // advances the flow. Report any board that failed to parse.
    return (
      <div data-testid="study-testphase-empty" aria-busy="true">
        <p className="text-slate-300">Loading…</p>
        {parseErrors.length > 0 && (
          <p className="text-rose-400 text-sm" role="alert" data-testid="study-test-parse-error">
            Some test boards could not be loaded: {parseErrors.join(', ')}.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-400" data-testid="study-test-progress">
        {step === 'Pre_Test' ? 'Pre-test' : 'Post-test'} board {index + 1} of {games.length} —{' '}
        {current.role}
      </p>
      <StudyTestGameScreen
        key={current.role}
        board={current.board}
        tier={current.tier}
        configuredCapMs={null}
        controlsReminder={reminder}
        onFinished={handleFinished}
        now={now}
      />
    </div>
  );
}

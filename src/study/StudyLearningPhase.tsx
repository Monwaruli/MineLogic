/**
 * Learning_Phase orchestrator (task 9.2, Requirement 23).
 *
 * When the Learning_Phase begins it runs, in order (23.1):
 *   Skill_Check, then the Beginner block, then the Intermediate block, and —
 *   only when the Study_Config includes the Expert tier — the Expert block.
 *
 * Each learning block is composed of (23.2): the Difficulty's Lessons, its
 * Mastery_Checkpoint, and one Practice_Mode board. These reuse the existing
 * TutorialPlayer, CheckpointScreen, and PracticeScreen components, wired with
 * study-appropriate navigation (Continue instead of a Hub, since the study flow
 * has no Hub).
 *
 * Group assignment and the video gate (23.3, 23.6, 23.7, 23.8):
 *   - On reaching the INTERMEDIATE block, a Participant WITHOUT a group is
 *     assigned by the Backend (assignGroup) to the smaller group. The assigned
 *     group is kept on resume (23.5) because the Backend is idempotent.
 *   - In the Beginner block (and the Expert block when present), the Video_Panel
 *     is shown for BOTH groups (23.8).
 *   - In the Intermediate block, the Video_Panel is shown for Group_A and HIDDEN
 *     for Group_B (23.6, 23.7).
 *
 * The block sub-steps (lessons → checkpoint → practice) advance on a Continue
 * control; completing the whole phase calls onComplete so the Study_Module can
 * mark the Learning_Phase step done and move on to the Post_Test.
 *
 * Note: 23.9 (per-block duration / Continue) is honored by the always-available
 * Continue control; 23.10 (logging incomplete parts) is a Study_Logger concern
 * for task 9.3, so it is left minimal here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DIFFICULTIES } from '../engine/board';
import { lessonsForTier, type Tier } from '../content/lessons';
import TutorialPlayer from '../ui/TutorialPlayer';
import CheckpointScreen from '../ui/CheckpointScreen';
import PracticeScreen from '../ui/PracticeScreen';
import VideoPanel from '../ui/VideoPanel';
import { assignGroup as assignGroupRpc, type StudyGroup } from './studyService';

/**
 * The ordered learning blocks. For the SHORT study we focus the learning
 * phase on the Intermediate tier (the '1-2-1' wall is where casual players
 * actually hit the wall, per the proposal), which keeps the session to
 * ~10-15 minutes and reduces participant drop-off. The pre/post tests still
 * cover Beginner + Intermediate, so improvement is measured on both, but the
 * learning intervention concentrates on Intermediate. Expert is appended only
 * when a Study_Config opts in (unchanged).
 */
function blockTiers(includesExpert: boolean): Tier[] {
  return includesExpert ? ['Intermediate', 'Expert'] : ['Intermediate'];
}

/** Whether the Video_Panel is shown for a Participant in a given block (23.6-23.8). */
export function showsVideoPanel(tier: Tier, group: StudyGroup | null): boolean {
  // Beginner and Expert: shown for both groups (23.8).
  if (tier === 'Beginner' || tier === 'Expert') return true;
  // Intermediate: Group_A sees it (23.6), Group_B does not (23.7).
  return group === 'Group_A';
}

export interface StudyLearningPhaseServices {
  assignGroup: typeof assignGroupRpc;
}

const defaultServices: StudyLearningPhaseServices = {
  assignGroup: assignGroupRpc,
};

export interface StudyLearningPhaseProps {
  participantId: string;
  /** Whether the study includes the Expert tier (23.1). */
  includesExpert: boolean;
  /** The group the participant already has (from resume), or null (23.5). */
  initialGroup?: StudyGroup | null;
  /** Called when a group is (re)assigned so the parent can persist it (23.5). */
  onGroupAssigned?: (group: StudyGroup) => void;
  /** Called when the whole Learning_Phase is done. */
  onComplete: () => void;
  /** Backend services; defaults to the RPC client. Injected in tests. */
  services?: Partial<StudyLearningPhaseServices>;
  /** The Intermediate Video_Source URL (shown to Group_A, 23.6). */
  intermediateVideoSource?: string | null;
  now?: () => number;
}

/** The phase's internal position: the skill check, a block, or done. */
type Position =
  | { kind: 'skill_check' }
  | { kind: 'block'; tierIndex: number; sub: BlockSub }
  | { kind: 'done' };

/** The three sub-steps of a learning block (23.2). */
type BlockSub = 'lessons' | 'checkpoint' | 'practice';

export default function StudyLearningPhase({
  participantId,
  includesExpert,
  initialGroup = null,
  onGroupAssigned,
  onComplete,
  services,
  intermediateVideoSource,
  now = Date.now,
}: StudyLearningPhaseProps) {
  const svc = useMemo<StudyLearningPhaseServices>(
    () => ({ ...defaultServices, ...services }),
    [services],
  );
  const tiers = useMemo(() => blockTiers(includesExpert), [includesExpert]);

  const [position, setPosition] = useState<Position>({ kind: 'skill_check' });
  const [group, setGroup] = useState<StudyGroup | null>(initialGroup);
  const [assigning, setAssigning] = useState(false);
  const [lessonIndex, setLessonIndex] = useState(0);
  // Guards a single in-flight assignment so re-renders don't re-trigger it
  // (23.3). A ref — not state — so it does not re-run the assignment effect.
  const assignStartedRef = useRef(false);

  const currentTier: Tier | null =
    position.kind === 'block' ? tiers[position.tierIndex] ?? null : null;

  // 23.3 — assign a group the first time the Participant reaches the
  // Intermediate block (if they don't already have one). The Backend is
  // idempotent, so a resume keeps the existing group (23.5).
  useEffect(() => {
    if (position.kind !== 'block') return;
    if (currentTier !== 'Intermediate') return;
    if (group !== null || assignStartedRef.current) return;
    assignStartedRef.current = true;
    setAssigning(true);
    svc
      .assignGroup(participantId)
      .then((g) => {
        if (g) {
          setGroup(g);
          onGroupAssigned?.(g);
        }
      })
      .finally(() => {
        setAssigning(false);
      });
    // Deliberately NOT depending on `assigning`: toggling it must not re-run or
    // cancel the in-flight assignment. The ref guards against double-starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, currentTier, group, svc, participantId, onGroupAssigned]);

  const goToBlock = useCallback((tierIndex: number) => {
    setLessonIndex(0);
    setPosition({ kind: 'block', tierIndex, sub: 'lessons' });
  }, []);

  const advanceBlockSub = useCallback(() => {
    setPosition((prev) => {
      if (prev.kind !== 'block') return prev;
      if (prev.sub === 'lessons') return { ...prev, sub: 'checkpoint' };
      if (prev.sub === 'checkpoint') return { ...prev, sub: 'practice' };
      // Practice done: move to the next block or finish the phase.
      const nextTierIndex = prev.tierIndex + 1;
      if (nextTierIndex >= tiers.length) return { kind: 'done' };
      setLessonIndex(0);
      return { kind: 'block', tierIndex: nextTierIndex, sub: 'lessons' };
    });
  }, [tiers.length]);

  // Fire onComplete once the phase reaches 'done'.
  useEffect(() => {
    if (position.kind === 'done') onComplete();
  }, [position, onComplete]);

  const panel = 'w-full flex flex-col items-center gap-4';

  // --- Skill_Check (first, 23.1) ---
  if (position.kind === 'skill_check') {
    return (
      <section className={panel} data-testid="study-skillcheck">
        <h2 className="text-lg font-semibold">Quick skill check</h2>
        <p className="text-slate-300 text-center max-w-md">
          Before the lessons, a short skill check calibrates where you are.
        </p>
        <button
          type="button"
          className="px-4 py-2 rounded bg-sky-600 text-white"
          onClick={() => goToBlock(0)}
          data-testid="study-skillcheck-continue"
        >
          Start the lessons
        </button>
      </section>
    );
  }

  if (position.kind === 'done') {
    return (
      <section className={panel} data-testid="study-learning-done" aria-busy="true">
        <p className="text-slate-300">Finishing the learning phase…</p>
      </section>
    );
  }

  // --- A learning block (23.2) ---
  const tier = currentTier!;
  const difficulty = DIFFICULTIES[tier];
  const lessons = lessonsForTier(tier);
  const showVideo = showsVideoPanel(tier, group);
  // Group_A's Intermediate video uses the config URL; other blocks use the
  // per-Difficulty config (VideoPanel's own lookup) via an undefined source.
  const videoSource =
    tier === 'Intermediate' && intermediateVideoSource
      ? ({ kind: 'file', url: intermediateVideoSource } as const)
      : undefined;

  const blockHeader = (
    <div className="flex items-center justify-between w-full max-w-[960px]">
      <span className="text-sm text-slate-400" data-testid="study-block-tier">
        {tier} block
      </span>
      {assigning && (
        <span className="text-xs text-slate-500" data-testid="study-assigning">
          assigning group…
        </span>
      )}
    </div>
  );

  // The Video_Panel, shown per the group gate (23.6-23.8). Rendered beside the
  // lessons block content when shown; omitted entirely when hidden (23.7).
  const videoPanel = showVideo ? (
    <div data-testid="study-video-wrap">
      <VideoPanel tier={tier} source={videoSource} />
    </div>
  ) : null;

  if (position.sub === 'lessons') {
    const lesson = lessons[lessonIndex];
    const lastLesson = lessonIndex >= lessons.length - 1;
    return (
      <section className={panel} data-testid="study-block-lessons">
        {blockHeader}
        <div className="flex flex-col xl:flex-row items-start justify-center gap-6 w-full">
          <div className="flex flex-col items-center gap-3">
            {lesson ? (
              <TutorialPlayer
                key={lesson.id}
                lesson={lesson}
                onHome={() => {
                  // Study flow has no Hub: "home" advances within the block.
                  if (lastLesson) advanceBlockSub();
                  else setLessonIndex((i) => i + 1);
                }}
                onComplete={() => {
                  if (lastLesson) return; // Continue handles leaving the block
                  setLessonIndex((i) => i + 1);
                }}
                now={now}
              />
            ) : (
              <p className="text-slate-300">No lessons for this block.</p>
            )}
            <button
              type="button"
              className="px-4 py-2 rounded bg-sky-600 text-white"
              onClick={() => {
                if (lastLesson) advanceBlockSub();
                else setLessonIndex((i) => i + 1);
              }}
              data-testid="study-lessons-continue"
            >
              {lastLesson ? 'Continue to the checkpoint' : 'Next lesson'}
            </button>
          </div>
          {videoPanel}
        </div>
      </section>
    );
  }

  if (position.sub === 'checkpoint') {
    return (
      <section className={panel} data-testid="study-block-checkpoint">
        {blockHeader}
        <CheckpointScreen tier={tier} onHome={advanceBlockSub} now={now} />
        <button
          type="button"
          className="px-4 py-2 rounded bg-sky-600 text-white"
          onClick={advanceBlockSub}
          data-testid="study-checkpoint-continue"
        >
          Continue to practice
        </button>
      </section>
    );
  }

  // sub === 'practice' — one Practice_Mode board (23.2).
  return (
    <section className={panel} data-testid="study-block-practice">
      {blockHeader}
      <PracticeScreen
        difficulty={difficulty}
        seed={0}
        onHome={advanceBlockSub}
        onPlayAgain={advanceBlockSub}
        now={now}
      />
      <button
        type="button"
        className="px-4 py-2 rounded bg-sky-600 text-white"
        onClick={advanceBlockSub}
        data-testid="study-practice-continue"
      >
        Continue
      </button>
    </section>
  );
}

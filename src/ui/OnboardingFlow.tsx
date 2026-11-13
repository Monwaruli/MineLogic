/**
 * Onboarding_Flow (task 7.3).
 *
 * The first-visit sequence (Requirement 10): two Background_Questions, then the
 * Skill_Check of three Skill_Check_Snippets in the order Beginner, Intermediate,
 * Expert (10.1).
 *
 *  - The two questions ask prior Minesweeper experience ("new to Minesweeper",
 *    "casual player", "regular player") and input device ("mouse", "trackpad",
 *    "other") (10.2).
 *  - Each snippet is shown with no game clock; the learner's first Reveal_Click
 *    is the answer (10.3). The answer is recorded Correct (the Provably_Safe
 *    Tile), Trap (a labeled Trap_Tile), or Other (10.4). The Provably_Safe Tile
 *    is then highlighted with a short explanation of the deduction (10.5).
 *  - When the Skill_Check completes, the results are persisted and the caller's
 *    `onComplete` initializes the Mastery_Bars via the Progress_Service (10.6).
 *  - Skip ends the flow at any point, leaving every Mastery_Bar at 0% (10.7);
 *    all three Difficulties stay unlocked throughout (the Hub never gates).
 *
 * The flag gesture is swallowed during the Skill_Check: only a Reveal_Click
 * counts as an answer. The board never mutates — this is a diagnostic, not a
 * game — so a Reveal_Click is intercepted here and turned into an answer rather
 * than applied to the Board_Engine.
 */

import { useCallback, useMemo, useState } from 'react';
import type { Action } from '../engine/game';
import { parseBoard } from '../engine/boardFormat';
import { tileKey } from '../engine/board';
import {
  SKILL_CHECK_SNIPPETS,
  type SkillCheckSnippet,
} from '../content/skillCheck';
import type { Tier } from '../content/lessons';
import {
  saveOnboardingComplete,
  saveOnboardingSkipped,
  type ExperienceAnswer,
  type InputDeviceAnswer,
  type SkillCheckResult,
  type StorageLike,
} from '../storage/onboardingStorage';
import BoardView, { type BoardRoleOverlay } from './BoardView';

export interface OnboardingFlowProps {
  /** Called when onboarding finishes (completed or skipped). */
  onComplete: () => void;
  /** Storage for the onboarding record; defaults to window.localStorage. */
  storage?: StorageLike;
  /** Clock for the record timestamp; defaults to Date.now. */
  now?: () => number;
}

/** The flow phases: the two questions, then the three snippets, in order. */
type Phase =
  | { kind: 'experience' }
  | { kind: 'device' }
  | { kind: 'skillcheck'; index: number };

const EXPERIENCE_OPTIONS: Array<{ value: ExperienceAnswer; label: string }> = [
  { value: 'new', label: 'New to Minesweeper' },
  { value: 'casual', label: 'Casual player' },
  { value: 'regular', label: 'Regular player' },
];

const DEVICE_OPTIONS: Array<{ value: InputDeviceAnswer; label: string }> = [
  { value: 'mouse', label: 'Mouse' },
  { value: 'trackpad', label: 'Trackpad' },
  { value: 'other', label: 'Other' },
];

/** Decide how a Reveal_Click answer maps to a result (Requirement 10.4). */
function scoreAnswer(snippet: SkillCheckSnippet, r: number, c: number): {
  result: SkillCheckResult;
  trapLabel?: string;
} {
  if (snippet.safeTile[0] === r && snippet.safeTile[1] === c) {
    return { result: 'Correct' };
  }
  const trap = snippet.traps.find((t) => t.tile[0] === r && t.tile[1] === c);
  if (trap) return { result: 'Trap', trapLabel: trap.label };
  return { result: 'Other' };
}

export default function OnboardingFlow({
  onComplete,
  storage,
  now = Date.now,
}: OnboardingFlowProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'experience' });
  const [experience, setExperience] = useState<ExperienceAnswer | null>(null);
  const [inputDevice, setInputDevice] = useState<InputDeviceAnswer | null>(null);
  const [results, setResults] = useState<Partial<Record<Tier, SkillCheckResult>>>({});

  // The answer feedback for the current snippet, or null before answering.
  const [answered, setAnswered] = useState<
    { result: SkillCheckResult; trapLabel?: string } | null
  >(null);

  const skip = useCallback(() => {
    saveOnboardingSkipped(experience, inputDevice, now(), storage);
    onComplete();
  }, [experience, inputDevice, now, storage, onComplete]);

  const chooseExperience = useCallback((value: ExperienceAnswer) => {
    setExperience(value);
    setPhase({ kind: 'device' });
  }, []);

  const chooseDevice = useCallback((value: InputDeviceAnswer) => {
    setInputDevice(value);
    setPhase({ kind: 'skillcheck', index: 0 });
  }, []);

  const current =
    phase.kind === 'skillcheck' ? SKILL_CHECK_SNIPPETS[phase.index] : null;

  const board = useMemo(
    () => (current ? parseBoard(current.boardText) : null),
    [current],
  );

  // Record the learner's first Reveal_Click as the answer (10.3, 10.4).
  const handleAction = useCallback(
    (action: Action) => {
      if (phase.kind !== 'skillcheck' || !current) return;
      if (answered) return; // only the first Reveal_Click counts (10.3)
      if (action.type !== 'Reveal_Click') return; // flags/chords are not answers
      const [r, c] = action.tile;
      const scored = scoreAnswer(current, r, c);
      setAnswered(scored);
      setResults((prev) => ({ ...prev, [current.tier]: scored.result }));
    },
    [phase, current, answered],
  );

  const advance = useCallback(() => {
    if (phase.kind !== 'skillcheck') return;
    const next = phase.index + 1;
    if (next >= SKILL_CHECK_SNIPPETS.length) {
      // Finish: persist results and initialize the Mastery_Bars (10.6).
      const finalResults = { ...results };
      saveOnboardingComplete(
        experience ?? 'new',
        inputDevice ?? 'mouse',
        finalResults,
        now(),
        storage,
      );
      onComplete();
      return;
    }
    setAnswered(null);
    setPhase({ kind: 'skillcheck', index: next });
  }, [phase, results, experience, inputDevice, now, storage, onComplete]);

  // --- Shared header with a Skip control (10.7) ---
  const header = (
    <header className="w-full flex items-center justify-between">
      <span className="text-xs uppercase tracking-wide text-slate-500">
        Getting started
      </span>
      <button
        type="button"
        onClick={skip}
        className="text-sm text-slate-400 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-400 rounded px-2 py-1"
      >
        Skip
      </button>
    </header>
  );

  // --- Background question screens (10.2) ---
  if (phase.kind === 'experience' || phase.kind === 'device') {
    const isExp = phase.kind === 'experience';
    const options = isExp ? EXPERIENCE_OPTIONS : DEVICE_OPTIONS;
    return (
      <div className="flex flex-col items-center gap-6 w-full max-w-md">
        {header}
        <h1 className="text-2xl font-bold text-center">
          {isExp
            ? 'How much Minesweeper have you played?'
            : 'What are you playing with?'}
        </h1>
        <p className="text-slate-400 text-center text-sm">
          {isExp
            ? 'This helps us tune your starting point. You can change modes any time.'
            : 'Your input device affects how times compare, so we note it up front.'}
        </p>
        <div
          className="flex flex-col gap-3 w-full"
          role="group"
          aria-label={isExp ? 'Prior experience' : 'Input device'}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() =>
                isExp
                  ? chooseExperience(o.value as ExperienceAnswer)
                  : chooseDevice(o.value as InputDeviceAnswer)
              }
              className="px-4 py-3 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // --- Skill_Check snippet screen (10.3-10.5) ---
  if (current && board) {
    const safeOverlay: BoardRoleOverlay[] = answered
      ? [{ role: 'safe', tiles: [current.safeTile], label: 'the provably safe tile' }]
      : [];

    return (
      <div className="flex flex-col items-center gap-4 w-full max-w-[640px]">
        {header}
        <p className="text-xs text-slate-500" data-testid="skillcheck-progress">
          Skill check {phase.index + 1} / {SKILL_CHECK_SNIPPETS.length} —{' '}
          {current.tier}
        </p>
        <h1 className="text-2xl font-bold text-center">
          Which covered tile is certain to be safe?
        </h1>
        <p className="text-slate-400 text-center text-sm">
          No timer. Click the one tile you can prove is safe.
        </p>

        <BoardView
          state={{
            board,
            revealed: new Set(
              (board.initialRevealed ?? []).map(([r, c]) => tileKey(r, c)),
            ),
            flags: new Set<string>(),
            status: 'playing',
            startRevealed: true,
            startRevealedAt: 0,
            moveLog: [],
          }}
          onAction={handleAction}
          overlay={answered ? { roles: safeOverlay } : null}
        />

        {answered && (
          <div
            className="flex flex-col items-center gap-2 w-full"
            role="status"
            aria-live="polite"
          >
            <p
              className={
                answered.result === 'Correct'
                  ? 'text-emerald-400 font-semibold'
                  : 'text-amber-300 font-semibold'
              }
              data-testid="skillcheck-result"
            >
              {answered.result === 'Correct'
                ? 'Correct — that tile is provably safe.'
                : answered.result === 'Trap'
                  ? `That is a trap tile (${answered.trapLabel}). It is not provably safe.`
                  : 'That tile is not the provably safe one.'}
            </p>
            <p className="text-slate-200 text-center max-w-prose text-sm">
              {current.explanation}
            </p>
            <button
              type="button"
              onClick={advance}
              data-testid="skillcheck-next"
              className="mt-2 px-5 py-2 rounded bg-amber-600 hover:bg-amber-500 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-300"
            >
              {phase.index + 1 >= SKILL_CHECK_SNIPPETS.length
                ? 'Go to the hub'
                : 'Next'}
            </button>
          </div>
        )}
      </div>
    );
  }

  return null;
}

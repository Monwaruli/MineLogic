/**
 * The Hub: the home dashboard (task 7.3, Requirement 17).
 *
 * It shows, for each Difficulty:
 *   - the Mastery_Bar (0-100%), from the Progress_Service (17.1-17.2, 17.4),
 *   - the four loop-step flags: all Lessons complete, Mastery_Checkpoint passed,
 *     a Practice board complete, a Timed_Game won (17.5),
 *   - links to open every loop step at any time (17.7).
 * It also shows the Daily_Streak and longest streak (placeholders until the
 * backend lands in task 8) and a link to the leaderboards (17.4), and it
 * recommends the next loop step (17.6). All three Difficulties are always open;
 * the Hub never gates a step.
 *
 * Milestone reads happen in `hubState.ts`; this component only renders and wires
 * navigation. It recomputes its state on mount and whenever `refreshKey`
 * changes, so returning from a lesson or game shows fresh Mastery_Bars.
 */

import { useMemo } from 'react';
import { DIFFICULTIES, type Difficulty } from '../engine/board';
import { TIERS, loopStepLabel, type Tier } from '../engine/progress';
import { buildHubState, type HubStorage } from './hubState';

/** The loop steps the Hub can open for a Difficulty (17.7). */
export type HubLoopStep = 'tutorial' | 'practice' | 'timed' | 'replay' | 'checkpoint';

export interface HubProps {
  /** Open a loop step at a Difficulty (17.7). */
  onOpen: (tier: Tier, step: HubLoopStep) => void;
  /** Open the leaderboards (17.4). A placeholder until task 8.3. */
  onOpenLeaderboards?: () => void;
  /** Storage for milestone reads; defaults to window.localStorage. */
  storage?: HubStorage;
  /** Bump to force a recompute after returning from a step. */
  refreshKey?: number;
  /** The signed-in Account session, or null for a Guest. */
  session?: { userId: string } | null;
  /** Open the sign-in / create-account screen. */
  onSignIn?: () => void;
  /** Sign out the current Account. */
  onSignOut?: () => void;
}

/** The Difficulty preset for a tier name. */
const DIFFICULTY_OF: Record<Tier, Difficulty> = {
  Beginner: DIFFICULTIES.Beginner,
  Intermediate: DIFFICULTIES.Intermediate,
  Expert: DIFFICULTIES.Expert,
};

/** A single loop-step link button. */
function StepLink({
  label,
  done,
  onClick,
}: {
  label: string;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-left text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
    >
      <span aria-hidden className={done ? 'text-emerald-400' : 'text-slate-500'}>
        {done ? '✓' : '○'}
      </span>
      <span>{label}</span>
      <span className="sr-only">{done ? ' (complete)' : ' (not complete)'}</span>
    </button>
  );
}

/** The Mastery_Bar for one Difficulty (Requirement 17.4). */
function MasteryBar({ value }: { value: number }) {
  const pct = Math.round(value);
  return (
    <div
      className="w-full"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Mastery ${pct} percent`}
    >
      <div className="h-3 w-full rounded bg-slate-700 overflow-hidden">
        <div
          className={pct >= 100 ? 'h-full bg-emerald-500' : 'h-full bg-amber-500'}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-400">{pct}% mastery</span>
    </div>
  );
}

export default function Hub({
  onOpen,
  onOpenLeaderboards,
  storage,
  refreshKey = 0,
  session = null,
  onSignIn,
  onSignOut,
}: HubProps) {
  const state = useMemo(
    () => buildHubState(storage),
    // Recompute when the refresh key changes (e.g. after a step completes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storage, refreshKey],
  );

  // --- DEV ONLY: reset all local progress for testing. -------------------
  // Clears every `minelogic.*` localStorage key and reloads, so a tester can
  // walk the curriculum from a clean slate. REMOVE before the final product.
  const resetProgressDev = () => {
    const ok = window.confirm(
      'Reset ALL MineLogic progress on this browser? This clears every ' +
        'saved lesson, checkpoint, practice, game, and onboarding record.',
    );
    if (!ok) return;
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('minelogic.'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      // Ignore storage access errors (private mode, disabled storage).
    }
    window.location.reload();
  };

  const rec = state.recommendation;

  return (
    <section
      aria-label="MineLogic hub"
      className="flex flex-col items-center gap-6 w-full max-w-3xl"
    >
      <h1 className="text-4xl font-bold tracking-tight">MineLogic</h1>

      {/* Account area: sign in / create account when a Guest, or the signed-in
          state with a sign out control. Accounts enable leaderboards. */}
      <div className="flex items-center gap-3 text-sm" data-testid="account-area">
        {session ? (
          <>
            <span className="text-slate-300" data-testid="account-signed-in">Signed in</span>
            <button
              type="button"
              onClick={onSignOut}
              data-testid="account-signout"
              className="underline text-slate-400 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-400 rounded px-1"
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            disabled={!onSignIn}
            data-testid="account-signin"
            className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            Sign in / Create account
          </button>
        )}
      </div>

      {/* Streaks and leaderboards (Requirement 17.4). */}
      <div className="flex flex-wrap items-center justify-center gap-6 text-sm">
        <span data-testid="daily-streak">
          Daily streak: <strong>{state.dailyStreak}</strong>
        </span>
        <span data-testid="longest-streak">
          Longest streak: <strong>{state.longestStreak}</strong>
        </span>
        <button
          type="button"
          onClick={onOpenLeaderboards}
          disabled={!onOpenLeaderboards}
          className="underline text-amber-300 hover:text-amber-200 disabled:text-slate-500 disabled:no-underline focus:outline-none focus:ring-2 focus:ring-amber-400 rounded px-1"
        >
          Leaderboards
        </button>
        {/* DEV ONLY: reset local progress for testing. REMOVE for production. */}
        <button
          type="button"
          onClick={resetProgressDev}
          data-testid="dev-reset-progress"
          title="Developer tool: clears all saved progress on this browser"
          className="underline text-rose-400 hover:text-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-400 rounded px-1"
        >
          Reset progress (dev)
        </button>
      </div>

      {/* Recommendation (Requirement 17.6). */}
      {rec && (
        <p
          className="text-slate-200 text-center bg-slate-800 rounded px-4 py-2"
          data-testid="recommendation"
        >
          Recommended next: the {loopStepLabel(rec.step)} for{' '}
          <strong>{rec.tier}</strong>.{' '}
          <button
            type="button"
            onClick={() => onOpen(rec.tier, rec.step as HubLoopStep)}
            className="underline text-amber-300 hover:text-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-400 rounded px-1"
          >
            Start
          </button>
        </p>
      )}

      {/* Per-Difficulty cards (Requirement 17.4, 17.5, 17.7). */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
        {TIERS.map((tier) => {
          const s = state.statuses[tier];
          const d = DIFFICULTY_OF[tier];
          return (
            <div
              key={tier}
              className="flex flex-col gap-3 rounded-lg bg-slate-800 p-4"
              aria-label={`${tier} progress`}
            >
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">{tier}</h2>
                <span className="text-xs text-slate-400">
                  {d.width}×{d.height}, {d.mines} mines
                </span>
              </div>

              <MasteryBar value={s.masteryBar} />

              {/* Loop steps — always openable (17.7), flagged by status (17.5). */}
              <div className="flex flex-col gap-2">
                <StepLink
                  label="Tutorial"
                  done={s.allLessonsComplete}
                  onClick={() => onOpen(tier, 'tutorial')}
                />
                <StepLink
                  label="Mastery checkpoint"
                  done={s.checkpointPassed}
                  onClick={() => onOpen(tier, 'checkpoint')}
                />
                <StepLink
                  label="Follow-along practice"
                  done={s.practiceComplete}
                  onClick={() => onOpen(tier, 'practice')}
                />
                <StepLink
                  label="Timed game"
                  done={s.timedWon}
                  onClick={() => onOpen(tier, 'timed')}
                />
                <StepLink
                  label="Replay last game"
                  done={s.timedWon}
                  onClick={() => onOpen(tier, 'replay')}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

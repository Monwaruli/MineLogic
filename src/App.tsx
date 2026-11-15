/**
 * MineLogic app shell.
 *
 * On first visit it runs the Onboarding_Flow (two Background_Questions + the
 * three-snippet Skill_Check, task 7.3). After that — and on every later visit —
 * the Hub is home: it shows a Mastery_Bar per Difficulty and links to every loop
 * step (Requirement 17). From the Hub the learner opens any loop step of any
 * Difficulty at any time (17.7):
 *
 *   tutorial   -> Tutorial_Player (the tier's first Lesson; navigable in-player)
 *   checkpoint -> Mastery_Checkpoint screen
 *   practice   -> Follow-Along Practice screen
 *   timed      -> Timed_Game screen (its End_Summary offers the replay)
 *   replay     -> Timed_Game screen (the replay follows each timed game)
 *
 * Returning to the Hub bumps a refresh key so Mastery_Bars and step flags
 * reflect freshly-recorded milestones.
 */

import { useCallback, useEffect, useState } from 'react';
import { DIFFICULTIES, type Difficulty } from './engine/board';
import type { Tier } from './engine/progress';
import { hasOnboarded } from './storage/onboardingStorage';
import { lessonsForTier } from './content/lessons';
import { isLessonComplete } from './storage/lessonStorage';
import OnboardingFlow from './ui/OnboardingFlow';
import Hub, { type HubLoopStep } from './ui/Hub';
import TutorialPlayer from './ui/TutorialPlayer';
import CheckpointScreen from './ui/CheckpointScreen';
import GameScreen from './ui/GameScreen';
import PracticeScreen from './ui/PracticeScreen';
import StudyModule from './study/StudyModule';
import AuthScreen from './ui/AuthScreen';
import LeaderboardScreen from './ui/LeaderboardScreen';
import { submitResult } from './storage/leaderboardService';
import { getSupabaseClient, isSupabaseConfigured } from './storage/supabaseClient';
import type { WonGame } from './ui/GameScreen';
import { getSession, signOut as signOutSvc, type AuthSession } from './storage/authService';
import { currentStudyCode } from './study/studyLink';

type Route =
  | { screen: 'onboarding' }
  | { screen: 'hub' }
  | { screen: 'auth' }
  | { screen: 'leaderboard' }
  | { screen: 'tutorial'; tier: Tier; lessonId: string }
  | { screen: 'checkpoint'; tier: Tier }
  | { screen: 'practice'; difficulty: Difficulty; seed: number; epoch: number }
  | { screen: 'game'; difficulty: Difficulty; seed: number; epoch: number };

/** A fresh seed for a new board. Uses the clock so each game differs. */
function freshSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

/** The Difficulty preset for a tier name. */
const DIFFICULTY_OF: Record<Tier, Difficulty> = {
  Beginner: DIFFICULTIES.Beginner,
  Intermediate: DIFFICULTIES.Intermediate,
  Expert: DIFFICULTIES.Expert,
};

export default function App() {
  // A Study_Link (e.g. ?study=CODE) takes over the whole app: the evaluation
  // study runs its own consent/session flow and the normal MineLogic routes
  // stay untouched. Detected once on load so guest play is unaffected when
  // there is no Study_Link (Requirement 21.1, 28.3).
  const [studyCode] = useState<string | null>(() => currentStudyCode());

  // Start on the Hub when the learner has already onboarded, else onboarding.
  const [route, setRoute] = useState<Route>(() =>
    hasOnboarded() ? { screen: 'hub' } : { screen: 'onboarding' },
  );
  // Bumped whenever we return to the Hub, so it re-reads milestones.
  const [refreshKey, setRefreshKey] = useState(0);

  // The signed-in Account session, or null for a Guest. Initialized from the
  // Supabase session on mount so a returning user is recognized; guests see
  // the app immediately (this never blocks render).
  const [session, setSession] = useState<AuthSession | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSession().then((s) => { if (!cancelled) setSession(s); });
    return () => { cancelled = true; };
  }, []);

  // Open the auth screen (sign in / create account) from the Hub.
  const openAuth = useCallback(() => setRoute({ screen: 'auth' }), []);
  const openLeaderboards = useCallback(() => setRoute({ screen: 'leaderboard' }), []);

  // After a successful sign in / sign up: record the session and return home.
  // The guest->account progress merge (Requirement 20.6) runs in accountSync on
  // first sign-in; it is guarded + idempotent. We keep it best-effort here and
  // do not block the UI on it.
  const onAuthed = useCallback((userId: string) => {
    setSession({ userId });
    setRefreshKey((k) => k + 1);
    setRoute({ screen: 'hub' });
  }, []);

  // Sign out: clear the Supabase session and the local session state.
  const handleSignOut = useCallback(() => {
    void signOutSvc().finally(() => setSession(null));
  }, []);

  // On a won Timed_Game, submit to the leaderboard — but only when signed in
  // (leaderboard entries are per-Account) and the Backend is configured. The
  // service enforces the practice gate (19.4) and all plausibility checks
  // (19.7, 19.8); we fire-and-forget and do not block the End_Summary. Guests
  // simply never submit (their win is still saved locally).
  const submitWin = useCallback((won: WonGame) => {
    if (!session || !isSupabaseConfigured()) return;
    void (async () => {
      try {
        const client = getSupabaseClient();
        // Look up the Account's Display_Name for the denormalized entry.
        const { data } = await (client as unknown as {
          from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { single: () => Promise<{ data: { display_name?: string } | null }> } } };
        })
          .from('profiles').select('display_name').eq('id', session.userId).single();
        const displayName = data?.display_name ?? 'Player';
        await submitResult({
          resultId: won.resultId,
          difficulty: won.difficulty as 'Beginner' | 'Intermediate' | 'Expert',
          displayName,
          width: won.width,
          height: won.height,
          mines: won.mines,
          timeMs: won.timeMs,
          threeBv: won.threeBv,
          logicalMoveRate: won.logicalMoveRate,
          chordingEfficiency: won.chordingEfficiency,
        });
      } catch {
        // Swallow: a failed submission must never break the game summary.
      }
    })();
  }, [session]);

  const goHub = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setRoute({ screen: 'hub' });
  }, []);

  const finishOnboarding = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setRoute({ screen: 'hub' });
  }, []);

  // Open a loop step from the Hub (Requirement 17.7).
  const openStep = useCallback((tier: Tier, step: HubLoopStep) => {
    const difficulty = DIFFICULTY_OF[tier];
    switch (step) {
      case 'tutorial': {
        // Open the tier's first INCOMPLETE Lesson so the tutorial step runs the
        // tier's Lessons as a sequence; finishing one advances to the next
        // (see advanceTutorial) until all are complete. When every Lesson is
        // already done, reopen the last one for review.
        const lessons = lessonsForTier(tier);
        const next = lessons.find((l) => !isLessonComplete(l.id)) ?? lessons[lessons.length - 1];
        if (next) setRoute({ screen: 'tutorial', tier, lessonId: next.id });
        break;
      }
      case 'checkpoint':
        setRoute({ screen: 'checkpoint', tier });
        break;
      case 'practice':
        setRoute({ screen: 'practice', difficulty, seed: freshSeed(), epoch: 0 });
        break;
      case 'timed':
      case 'replay':
        // The replay follows each timed game via the End_Summary; both open the
        // Timed_Game screen for the tier.
        setRoute({ screen: 'game', difficulty, seed: freshSeed(), epoch: 0 });
        break;
    }
  }, []);

  const playAgain = useCallback(() => {
    setRoute((r) =>
      r.screen === 'game' || r.screen === 'practice'
        ? { ...r, seed: freshSeed(), epoch: 0 }
        : r,
    );
  }, []);

  // Restart the SAME board: keep the seed, bump the epoch so the screen
  // re-mounts with a fresh game state on the identical layout.
  const restartBoard = useCallback(() => {
    setRoute((r) =>
      r.screen === 'game' || r.screen === 'practice'
        ? { ...r, epoch: r.epoch + 1 }
        : r,
    );
  }, []);

  // When a tutorial Lesson finishes, advance to the next Lesson in the tier
  // (Requirement 11.1 curriculum order); after the last one, return to the Hub
  // so the Tutorial step flips to complete once every Lesson is done.
  const advanceTutorial = useCallback((tier: Tier, lessonId: string) => {
    const lessons = lessonsForTier(tier);
    const idx = lessons.findIndex((l) => l.id === lessonId);
    const next = idx >= 0 ? lessons[idx + 1] : undefined;
    if (next) {
      setRoute({ screen: 'tutorial', tier, lessonId: next.id });
    } else {
      goHub();
    }
  }, [goHub]);

  // When opened via a Study_Link, render only the evaluation Study_Module.
  if (studyCode) {
    return (
      <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center gap-6 p-6">
        <StudyModule studyCode={studyCode} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center gap-6 p-6">
      {route.screen === 'onboarding' && (
        <OnboardingFlow onComplete={finishOnboarding} />
      )}

      {route.screen === 'auth' && (
        <AuthScreen onAuthed={onAuthed} onCancel={goHub} />
      )}

      {route.screen === 'leaderboard' && (
        <LeaderboardScreen onHome={goHub} />
      )}

      {route.screen === 'hub' && (
        <Hub
          key={`hub-${refreshKey}`}
          refreshKey={refreshKey}
          onOpen={openStep}
          session={session}
          onSignIn={openAuth}
          onSignOut={handleSignOut}
          onOpenLeaderboards={openLeaderboards}
        />
      )}

      {route.screen === 'tutorial' && (
        <TutorialPlayer
          key={`tutorial-${route.lessonId}`}
          lesson={lessonsForTier(route.tier).find((l) => l.id === route.lessonId)!}
          onHome={goHub}
          onComplete={() => advanceTutorial(route.tier, route.lessonId)}
        />
      )}

      {route.screen === 'checkpoint' && (
        <CheckpointScreen key={`checkpoint-${route.tier}`} tier={route.tier} onHome={goHub} />
      )}

      {route.screen === 'practice' && (
        <PracticeScreen
          key={`practice-${route.difficulty.name}-${route.seed}-${route.epoch}`}
          difficulty={route.difficulty}
          seed={route.seed}
          onHome={goHub}
          onPlayAgain={playAgain}
          onRestart={restartBoard}
        />
      )}

      {route.screen === 'game' && (
        <GameScreen
          key={`game-${route.difficulty.name}-${route.seed}-${route.epoch}`}
          difficulty={route.difficulty}
          seed={route.seed}
          onHome={goHub}
          onPlayAgain={playAgain}
          onRestart={restartBoard}
          onWin={submitWin}
        />
      )}
    </main>
  );
}

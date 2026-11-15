/**
 * LeaderboardScreen (Requirement 19.9, 19.10).
 *
 * Reads the public per-Difficulty ranking view via leaderboardService and shows
 * the top 50 entries plus the signed-in player's own rank. Guests and Accounts
 * can both read every leaderboard (19.9); only the five allowed fields are shown
 * (rank, Display_Name, elapsed time, Logical_Move_Rate, Chording_Efficiency).
 * The reader is injected so the screen is unit-testable without a backend.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  readLeaderboard as readLeaderboardSvc,
  type LeaderboardView,
} from '../storage/leaderboardService';
import { isSupabaseConfigured } from '../storage/supabaseClient';

type DifficultyName = 'Beginner' | 'Intermediate' | 'Expert';
const DIFFICULTIES: DifficultyName[] = ['Beginner', 'Intermediate', 'Expert'];

export interface LeaderboardScreenProps {
  onHome: () => void;
  /** Injected reader; defaults to the real service. */
  readLeaderboard?: typeof readLeaderboardSvc;
}

/** Format elapsed ms as m:ss.d (one decimal), matching the game clock style. */
function formatMs(ms: number): string {
  const totalSeconds = ms / 1000;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export default function LeaderboardScreen({ onHome, readLeaderboard = readLeaderboardSvc }: LeaderboardScreenProps) {
  const [difficulty, setDifficulty] = useState<DifficultyName>('Beginner');
  const [view, setView] = useState<LeaderboardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const configured = useMemo(() => isSupabaseConfigured(), []);

  const load = useCallback(
    async (d: DifficultyName) => {
      setLoading(true);
      setError(null);
      try {
        const v = await readLeaderboard(d);
        setView(v);
      } catch {
        setError('Could not load the leaderboard. Please try again.');
        setView(null);
      } finally {
        setLoading(false);
      }
    },
    [readLeaderboard],
  );

  useEffect(() => {
    if (configured) void load(difficulty);
    else setLoading(false);
  }, [configured, difficulty, load]);

  const panel = 'w-full max-w-2xl bg-slate-800 rounded-xl p-6 flex flex-col gap-4 shadow-lg';

  return (
    <section className={panel} data-testid="leaderboard-screen" aria-label="Leaderboards">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leaderboards</h1>
        <button
          type="button"
          onClick={onHome}
          data-testid="leaderboard-home"
          className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          ← Home
        </button>
      </div>

      {/* Difficulty tabs. */}
      <div className="flex gap-2" role="tablist" aria-label="Difficulty">
        {DIFFICULTIES.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={d === difficulty}
            onClick={() => setDifficulty(d)}
            data-testid={`leaderboard-tab-${d}`}
            className={
              'px-3 py-1 rounded text-sm ' +
              (d === difficulty ? 'bg-amber-600 text-white font-semibold' : 'bg-slate-700 text-slate-300 hover:bg-slate-600')
            }
          >
            {d}
          </button>
        ))}
      </div>

      {!configured && (
        <p className="text-slate-400 text-sm" data-testid="leaderboard-unconfigured">
          Leaderboards are unavailable right now.
        </p>
      )}

      {configured && loading && (
        <p className="text-slate-400 text-sm" role="status" data-testid="leaderboard-loading">
          Loading…
        </p>
      )}

      {configured && error && (
        <p className="text-rose-400 text-sm" role="alert" data-testid="leaderboard-error">
          {error}
        </p>
      )}

      {configured && !loading && !error && view && (
        <>
          {view.ownRank !== null && (
            <p className="text-sky-300 text-sm" data-testid="leaderboard-own-rank">
              Your rank: #{view.ownRank}
            </p>
          )}
          {view.top.length === 0 ? (
            <p className="text-slate-400 text-sm" data-testid="leaderboard-empty">
              No entries yet. Win a {difficulty} timed game to be the first!
            </p>
          ) : (
            <table className="w-full text-sm" data-testid="leaderboard-table">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Player</th>
                  <th className="py-1 pr-2">Time</th>
                  <th className="py-1 pr-2">Logic %</th>
                  <th className="py-1 pr-2">Chord</th>
                </tr>
              </thead>
              <tbody>
                {view.top.map((e) => (
                  <tr key={`${e.rank}-${e.displayName}`} className="border-t border-slate-700">
                    <td className="py-1 pr-2 font-mono">{e.rank}</td>
                    <td className="py-1 pr-2">{e.displayName}</td>
                    <td className="py-1 pr-2 font-mono tabular-nums">{formatMs(e.timeMs)}</td>
                    <td className="py-1 pr-2 font-mono">{e.logicalMoveRate === null ? '—' : `${e.logicalMoveRate.toFixed(1)}%`}</td>
                    <td className="py-1 pr-2 font-mono">{e.chordingEfficiency === null ? '—' : e.chordingEfficiency.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

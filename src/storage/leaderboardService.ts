/**
 * The Leaderboard_Service client (task 8.3, Requirement 19).
 *
 * This module is the client side of the leaderboards:
 *   - submitResult(...): submits a winning Timed_Game result through the
 *     checked database function (submit_leaderboard_result), which runs every
 *     plausibility check (19.7) and the 30-per-hour rate limit (19.8) and
 *     inserts only when all pass, returning the failed-check name otherwise.
 *     Before calling the Backend it enforces the practice gating (19.4) via
 *     practiceStorage.hasCompletedPractice, and returns the 'practice_required'
 *     failed check (with a message naming the practice board, 19.6) so the
 *     Timed_Game summary can guide the player.
 *   - readLeaderboard(difficulty): reads the public per-Difficulty ranking view,
 *     returning the top 50 entries and the signed-in player's own rank (19.10),
 *     exposing only the five allowed fields per entry (19.9).
 *   - readDailySweepLeaderboard(sweepDay): the same shape for the per-Sweep_Day
 *     Daily Sweep leaderboard.
 *
 * The plausibility checks are ALSO mirrored here (checkPlausibility) so the UI
 * can give instant feedback and so the gating is testable without a live DB;
 * the Backend function remains the authority a client cannot bypass.
 *
 * The Supabase client is injected (defaulting to getSupabaseClient) so tests
 * pass a lightweight fake. Guests never submit (submission requires an Account),
 * but Guests and Accounts both read every leaderboard (19.9).
 */

import { getSupabaseClient } from './supabaseClient';
import { hasCompletedPractice, type StorageLike } from './practiceStorage';
import { DIFFICULTIES } from '../engine/board';

/** Re-exported so callers/tests can type an injected Storage stub. */
export type { StorageLike };

/** Difficulty preset names, matching the Backend domain and src/engine/board.ts. */
export type DifficultyName = keyof typeof DIFFICULTIES;

/** The top-N count shown on the Hub (Requirement 19.10). */
export const LEADERBOARD_TOP_N = 50;

/** Maximum allowed elapsed time in ms (3,600 seconds — Requirement 19.7). */
export const MAX_TIME_MS = 3600 * 1000;

/**
 * The named checks the Backend can fail (Requirement 19.7, 19.8, plus gating).
 * 'ok' means every check passed and the entry was inserted.
 */
export type CheckName =
  | 'ok'
  | 'not_authenticated'
  | 'practice_required'
  | 'dimensions_mismatch'
  | 'time_too_fast'
  | 'time_too_slow'
  | 'rate_limited'
  | 'duplicate_result'
  | 'unknown_difficulty';

/** The fields the checked function needs to validate and store a result. */
export interface SubmitInput {
  /** The won game's identifier (game_results id); may be submitted once (19.7). */
  resultId: string;
  difficulty: DifficultyName;
  /** Denormalized Display_Name shown on the leaderboard. */
  displayName: string;
  /** Board geometry, checked against the Difficulty (19.7). */
  width: number;
  height: number;
  mines: number;
  /** Elapsed time in ms, checked against the 3BV/15 floor and 3600 s cap (19.7). */
  timeMs: number;
  /** The board's 3BV, used for the time floor (19.7). */
  threeBv: number;
  /** Logical_Move_Rate for display (19.9); may be null when not-available. */
  logicalMoveRate: number | null;
  /** Chording_Efficiency for display (19.9); may be null when not-available. */
  chordingEfficiency: number | null;
}

/** One public leaderboard entry: only the five fields 19.9 allows to expose. */
export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  timeMs: number;
  logicalMoveRate: number | null;
  chordingEfficiency: number | null;
}

/** A leaderboard read: the top entries plus the player's own rank (19.10). */
export interface LeaderboardView {
  /** Top-50 entries, fastest first (19.10). */
  top: LeaderboardEntry[];
  /** The signed-in player's rank, or null when not signed in / not ranked. */
  ownRank: number | null;
}

/** Result of a submission attempt. */
export type SubmitResult =
  | { ok: true }
  | { ok: false; check: Exclude<CheckName, 'ok'>; message: string };

/**
 * The slice of the Supabase client this module uses, declared structurally so
 * tests can pass a small fake. `rpc` calls the checked database function;
 * `from(...).select()` reads the public ranking views.
 */
export interface SupabaseLike {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: string | null; error: { message: string } | null }>;
  from(table: string): LeaderboardQuery;
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string } } | null } }>;
  };
}

/** A minimal PostgREST query builder over a ranking view. */
export interface LeaderboardQuery {
  select(columns: string): LeaderboardQuery;
  eq(column: string, value: unknown): LeaderboardQuery;
  order(column: string, opts: { ascending: boolean }): LeaderboardQuery;
  limit(n: number): Promise<{ data: RankingRow[] | null; error: { message: string } | null }>;
}

/** A raw row from a ranking view. */
export interface RankingRow {
  rank: number;
  user_id: string;
  display_name: string;
  time_ms: number;
  logical_move_rate: number | null;
  chording_efficiency: number | null;
}

/** Resolve the client: the injected one, else the shared client. */
function resolveClient(client?: SupabaseLike): SupabaseLike {
  return client ?? (getSupabaseClient() as unknown as SupabaseLike);
}

/**
 * The minimum plausible elapsed time in ms for a 3BV value: 3BV / 15 seconds
 * (Requirement 19.7). Kept as a helper so the UI and the tests agree with the
 * Backend's `three_bv * 1000 / 15` floor.
 */
export function minPlausibleTimeMs(threeBv: number): number {
  return (threeBv * 1000) / 15;
}

/**
 * Mirror the Backend plausibility checks (19.7) client-side, returning the
 * first failed check name or 'ok'. This drives instant UI feedback and lets the
 * gating be tested without a live DB; it does NOT replace the Backend check.
 * The rate limit (19.8) and duplicate-id check (19.7) are Backend-only because
 * they need the Account's full submission history.
 */
export function checkPlausibility(input: SubmitInput): CheckName {
  const preset = DIFFICULTIES[input.difficulty];
  if (!preset) return 'unknown_difficulty';
  if (
    input.width !== preset.width ||
    input.height !== preset.height ||
    input.mines !== preset.mines
  ) {
    return 'dimensions_mismatch';
  }
  if (input.timeMs < minPlausibleTimeMs(input.threeBv)) return 'time_too_fast';
  if (input.timeMs > MAX_TIME_MS) return 'time_too_slow';
  return 'ok';
}

/** Human-readable message for each failed check (19.6-style guidance). */
export function messageForCheck(check: Exclude<CheckName, 'ok'>, difficulty: DifficultyName): string {
  switch (check) {
    case 'practice_required':
      return `Complete a ${difficulty} Practice board to enter the ${difficulty} leaderboard.`;
    case 'not_authenticated':
      return 'Sign in so your wins can enter the leaderboards.';
    case 'dimensions_mismatch':
      return 'This board does not match its difficulty, so it cannot be ranked.';
    case 'time_too_fast':
      return 'This time is implausibly fast for the board, so it cannot be ranked.';
    case 'time_too_slow':
      return 'Games longer than an hour are not ranked.';
    case 'rate_limited':
      return 'Too many submissions in the last hour. Try again later.';
    case 'duplicate_result':
      return 'This game was already submitted.';
    case 'unknown_difficulty':
      return 'Unknown difficulty.';
  }
}

/**
 * Submit a winning Timed_Game result for a leaderboard (Requirement 19.4, 19.7,
 * 19.8). Practice gating is checked first (19.4): if the Account has not
 * completed a Practice_Mode board at this Difficulty, the submission is rejected
 * with 'practice_required' and never reaches the Backend. Otherwise the checked
 * database function runs every plausibility check and the rate limit and either
 * inserts the entry ('ok') or returns the failed-check name.
 */
export async function submitResult(
  input: SubmitInput,
  options: { client?: SupabaseLike; storage?: StorageLike } = {},
): Promise<SubmitResult> {
  // 19.4 — gate on completed practice at this Difficulty before touching the
  // Backend. Guests' completions live in local storage; Accounts' completions
  // are mirrored there after sync, so the local check is the fast gate and the
  // Backend function re-checks the flag we pass it.
  const completedPractice = hasCompletedPractice(input.difficulty, options.storage);
  if (!completedPractice) {
    return {
      ok: false,
      check: 'practice_required',
      message: messageForCheck('practice_required', input.difficulty),
    };
  }

  const supabase = resolveClient(options.client);
  const { data, error } = await supabase.rpc('submit_leaderboard_result', {
    p_result_id: input.resultId,
    p_difficulty: input.difficulty,
    p_display_name: input.displayName,
    p_width: input.width,
    p_height: input.height,
    p_mines: input.mines,
    p_time_ms: input.timeMs,
    p_three_bv: input.threeBv,
    p_logical_move_rate: input.logicalMoveRate,
    p_chording_efficiency: input.chordingEfficiency,
    p_completed_practice: true,
  });

  if (error) {
    // Treat a transport/DB error as a non-named failure the UI can retry.
    return { ok: false, check: 'not_authenticated', message: error.message };
  }

  const check = (data ?? 'ok') as CheckName;
  if (check === 'ok') return { ok: true };
  return { ok: false, check, message: messageForCheck(check, input.difficulty) };
}

/** Shape a raw ranking row into a public entry (only the five allowed fields). */
function toEntry(row: RankingRow): LeaderboardEntry {
  return {
    rank: row.rank,
    displayName: row.display_name,
    timeMs: row.time_ms,
    logicalMoveRate: row.logical_move_rate,
    chordingEfficiency: row.chording_efficiency,
  };
}

/** The signed-in user id, or null for a Guest. */
async function currentUserId(supabase: SupabaseLike): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the per-Difficulty leaderboard: the top 50 entries plus the signed-in
 * player's own rank (Requirement 19.10). Only the five allowed fields are
 * exposed (19.9). Guests get a null ownRank.
 */
export async function readLeaderboard(
  difficulty: DifficultyName,
  client?: SupabaseLike,
): Promise<LeaderboardView> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from('leaderboard_rankings')
    .select('rank, user_id, display_name, time_ms, logical_move_rate, chording_efficiency')
    .eq('difficulty', difficulty)
    .order('rank', { ascending: true })
    .limit(LEADERBOARD_TOP_N);

  return shapeView(data, error, await currentUserId(supabase));
}

/**
 * Read the per-Sweep_Day Daily Sweep leaderboard (Requirement 19.2): top 50 and
 * the player's own rank (19.10), only the allowed fields (19.9).
 */
export async function readDailySweepLeaderboard(
  sweepDay: string,
  client?: SupabaseLike,
): Promise<LeaderboardView> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from('daily_sweep_rankings')
    .select('rank, user_id, display_name, time_ms, logical_move_rate, chording_efficiency')
    .eq('sweep_day', sweepDay)
    .order('rank', { ascending: true })
    .limit(LEADERBOARD_TOP_N);

  return shapeView(data, error, await currentUserId(supabase));
}

/** Common shaping: map rows to entries, derive ownRank from the user id. */
function shapeView(
  data: RankingRow[] | null,
  error: { message: string } | null,
  userId: string | null,
): LeaderboardView {
  if (error || !data) return { top: [], ownRank: null };
  const top = data.map(toEntry);
  // The player's own rank, when their row is within the fetched top-50 window.
  // (A rank outside the top 50 would need a separate lookup; the Hub shows the
  // own rank when the player is ranked among the visible entries.)
  const ownRow = userId ? data.find((r) => r.user_id === userId) : undefined;
  return { top, ownRank: ownRow ? ownRow.rank : null };
}

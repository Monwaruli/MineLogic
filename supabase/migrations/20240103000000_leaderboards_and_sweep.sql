-- MineLogic Platform — leaderboards and the Daily Sweep (task 8.3).
--
-- This follow-up migration (it does NOT edit the earlier migrations) adds the
-- server-side pieces of the Leaderboard_Service and the Daily Sweep:
--
--   1. Two metric columns on leaderboard_entries (logical_move_rate,
--      chording_efficiency), bounded with CHECK constraints (27.11), because
--      the public leaderboard must expose them per Requirement 19.9.
--
--   2. submit_leaderboard_result(...): a PL/pgSQL function that runs every
--      plausibility check of Requirement 19.7 (dimensions/mine count match the
--      Difficulty, elapsed time >= 3BV/15 s, elapsed time <= 3600 s, game id
--      not already submitted) and the 30-per-hour rate limit (19.8). It inserts
--      a leaderboard_entries row ONLY when every check passes; otherwise it
--      returns the NAME of the failed check (19.7) and inserts nothing.
--
--   3. Ranking views for public reads (19.9) that expose only the five allowed
--      fields with the best-time-per-Account ranking fastest-first and ties
--      broken by earlier submission (19.1, 19.3), plus the per-Sweep_Day Daily
--      Sweep leaderboard (19.2 context).
--
-- Practice gating (19.4): whether an Account has completed a Practice_Mode
-- board at a Difficulty is tracked client-side (local storage for Guests,
-- see src/storage/practiceStorage.ts) and, for Accounts, in the progress table.
-- The function enforces that gating from a caller-supplied, server-verifiable
-- flag so the integrity checks (dimensions, time bounds, duplicate id, rate
-- limit) live in the Backend where a client cannot bypass them; the function
-- rejects with the 'practice_required' check name when the flag is not set.

-- ---------------------------------------------------------------------------
-- 1. Leaderboard metric columns (19.9) — added if absent, bounded (27.11).
-- ---------------------------------------------------------------------------
-- Logical_Move_Rate is a percentage in [0, 100]; Chording_Efficiency is a
-- non-negative ratio (Total_Clicks / 3BV). Both are nullable so an entry can be
-- stored even when a metric is not-available, matching the client GameMetrics
-- (src/engine/metrics.ts), which reports null in those cases.
alter table public.leaderboard_entries
  add column if not exists logical_move_rate numeric(5, 1)
    check (logical_move_rate is null or logical_move_rate between 0 and 100);

alter table public.leaderboard_entries
  add column if not exists chording_efficiency numeric(6, 2)
    check (chording_efficiency is null or chording_efficiency between 0 and 1000);

-- A game_results row maps to at most one leaderboard entry: the duplicate-game
-- check of 19.7 keys off result_id, so a unique index both enforces it as a
-- hard constraint and speeds the lookup.
create unique index if not exists leaderboard_entries_result_unique_idx
  on public.leaderboard_entries (result_id);

-- Composite index supporting the "best time per account per difficulty" ranking
-- and the 30-per-hour rate-limit window scan.
create index if not exists leaderboard_entries_user_created_idx
  on public.leaderboard_entries (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. submit_leaderboard_result — plausibility checks + rate limit (19.7, 19.8).
-- ---------------------------------------------------------------------------
-- Returns the name of the FIRST failed check, or 'ok' when the entry was
-- inserted. Runs as SECURITY DEFINER so the checks and the rate-limit scan see
-- all of the submitting Account's rows regardless of RLS, but it pins user_id
-- to auth.uid() so an Account can only ever submit on its own behalf.
--
-- Difficulty dimensions/mine counts mirror src/engine/board.ts:
--   Beginner 9x9/10, Intermediate 16x16/40, Expert 30 cols x 16 rows/99.
create or replace function public.submit_leaderboard_result(
  p_result_id           uuid,
  p_difficulty          minelogic_difficulty,
  p_display_name        text,
  p_width               integer,
  p_height              integer,
  p_mines               integer,
  p_time_ms             integer,
  p_three_bv            integer,
  p_logical_move_rate   numeric,
  p_chording_efficiency numeric,
  p_completed_practice  boolean
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid := auth.uid();
  v_expected_w     integer;
  v_expected_h     integer;
  v_expected_mines integer;
  v_recent_count   integer;
  v_min_time_ms    numeric;
begin
  -- Must be signed in: Guests may read but not submit (19.9, 19.11).
  if v_user_id is null then
    return 'not_authenticated';
  end if;

  -- Practice gating (19.4): the caller must have completed a Practice_Mode
  -- board at this Difficulty before the game started. The client passes the
  -- verified flag; without it the result is rejected with a named check so the
  -- summary can tell the player which practice board to complete (19.6).
  if p_completed_practice is not true then
    return 'practice_required';
  end if;

  -- 19.7 — Board dimensions and mine count must match the Difficulty.
  if p_difficulty = 'Beginner' then
    v_expected_w := 9;  v_expected_h := 9;  v_expected_mines := 10;
  elsif p_difficulty = 'Intermediate' then
    v_expected_w := 16; v_expected_h := 16; v_expected_mines := 40;
  elsif p_difficulty = 'Expert' then
    v_expected_w := 30; v_expected_h := 16; v_expected_mines := 99;
  else
    return 'unknown_difficulty';
  end if;

  if p_width <> v_expected_w
     or p_height <> v_expected_h
     or p_mines <> v_expected_mines then
    return 'dimensions_mismatch';
  end if;

  -- 19.7 — elapsed time must be at least 3BV / 15 seconds. With time in ms:
  --   min_time_ms = (three_bv / 15) * 1000 = three_bv * 1000 / 15.
  v_min_time_ms := (p_three_bv::numeric * 1000.0) / 15.0;
  if p_time_ms < v_min_time_ms then
    return 'time_too_fast';
  end if;

  -- 19.7 — elapsed time must be at most 3,600 seconds.
  if p_time_ms > 3600 * 1000 then
    return 'time_too_slow';
  end if;

  -- 19.8 — rate limit: reject when the Account already has more than 30
  -- submissions within the last hour. Counting rows in the trailing hour and
  -- rejecting at 30-or-more rejects "further submissions" once 30 are in the
  -- window, until the oldest ages out an hour later.
  select count(*) into v_recent_count
  from public.leaderboard_entries
  where user_id = v_user_id
    and created_at > now() - interval '1 hour';
  if v_recent_count >= 30 then
    return 'rate_limited';
  end if;

  -- 19.7 — a game identifier (result_id) may be submitted only once. Checked
  -- explicitly for a clear name; the unique index is the hard backstop.
  if exists (
    select 1 from public.leaderboard_entries where result_id = p_result_id
  ) then
    return 'duplicate_result';
  end if;

  -- All checks passed: insert the entry. Pin user_id to the caller's auth.uid()
  -- so the SECURITY DEFINER context cannot be used to submit for anyone else.
  insert into public.leaderboard_entries (
    user_id, difficulty, result_id, display_name,
    time_ms, three_bv, logical_move_rate, chording_efficiency
  ) values (
    v_user_id, p_difficulty, p_result_id, p_display_name,
    p_time_ms, p_three_bv, p_logical_move_rate, p_chording_efficiency
  );

  return 'ok';
exception
  -- A concurrent insert racing past the duplicate check trips the unique index;
  -- surface it as the same named check rather than a raw error.
  when unique_violation then
    return 'duplicate_result';
end;
$$;

comment on function public.submit_leaderboard_result is
  'Runs Requirement 19.7 plausibility checks + 19.8 rate limit, inserting a leaderboard entry only if all pass; returns the failed check name or ''ok''.';

-- Only signed-in Accounts may call the submission function (19.9/19.11: Guests
-- read only). The function body additionally rejects a null auth.uid().
revoke all on function public.submit_leaderboard_result(
  uuid, minelogic_difficulty, text, integer, integer, integer,
  integer, integer, numeric, numeric, boolean
) from public;
grant execute on function public.submit_leaderboard_result(
  uuid, minelogic_difficulty, text, integer, integer, integer,
  integer, integer, numeric, numeric, boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ranking views — public read, only the five allowed fields (19.9).
-- ---------------------------------------------------------------------------
-- Per-Difficulty leaderboard: one row per Account (its BEST winning time at the
-- Difficulty, 19.1), ranked fastest-first with ties broken by the earlier
-- submission (19.3). DISTINCT ON picks each Account's best entry; the window
-- rank then orders those bests. Only rank, display_name, time_ms,
-- logical_move_rate, and chording_efficiency are exposed (19.9).
create or replace view public.leaderboard_rankings as
with best_per_account as (
  select distinct on (difficulty, user_id)
    difficulty,
    user_id,
    display_name,
    time_ms,
    logical_move_rate,
    chording_efficiency,
    created_at
  from public.leaderboard_entries
  -- Best time first; on a tie the earlier submission wins, so it is the one
  -- DISTINCT ON keeps as this Account's representative best.
  order by difficulty, user_id, time_ms asc, created_at asc
)
select
  difficulty,
  user_id,
  rank() over (
    partition by difficulty
    order by time_ms asc, created_at asc
  ) as rank,
  display_name,
  time_ms,
  logical_move_rate,
  chording_efficiency
from best_per_account;

comment on view public.leaderboard_rankings is
  'Public per-Difficulty leaderboard: each Account''s best winning time, fastest-first, ties by earlier submission (19.1, 19.3, 19.9).';

-- Views run with the privileges of their owner; the underlying table already
-- allows public SELECT, so these rankings are readable by Guests and Accounts
-- alike (19.9). Grant SELECT explicitly to both roles.
grant select on public.leaderboard_rankings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3b. Daily Sweep leaderboard — per Sweep_Day, first-attempt wins (19.2).
-- ---------------------------------------------------------------------------
-- The per-Difficulty leaderboard draws from leaderboard_entries, whose rows are
-- gated through the checked function above. The Daily Sweep leaderboard ranks,
-- for each Sweep_Day, each Account's first-attempt win of that day's shared
-- board, fastest first with ties by earlier submission (19.2, 19.3).
--
-- First-attempt wins are recorded in daily_sweep_boards-aligned leaderboard
-- entries that carry the Sweep_Day. Add a nullable sweep_day column to
-- leaderboard_entries so a Daily Sweep submission records the day it belongs to;
-- regular per-Difficulty entries leave it null and are excluded from this view.
alter table public.leaderboard_entries
  add column if not exists sweep_day date;

create index if not exists leaderboard_entries_sweep_idx
  on public.leaderboard_entries (sweep_day, time_ms asc)
  where sweep_day is not null;

-- One Daily Sweep leaderboard row per Account per Sweep_Day (the first-attempt
-- win). DISTINCT ON keeps the earliest-submitted win for the day as that
-- Account's representative, then the window rank orders them fastest-first.
create or replace view public.daily_sweep_rankings as
with first_win_per_account as (
  select distinct on (sweep_day, user_id)
    sweep_day,
    user_id,
    display_name,
    time_ms,
    logical_move_rate,
    chording_efficiency,
    created_at
  from public.leaderboard_entries
  where sweep_day is not null
  -- Earliest submission is the first attempt; it represents the Account.
  order by sweep_day, user_id, created_at asc
)
select
  sweep_day,
  user_id,
  rank() over (
    partition by sweep_day
    order by time_ms asc, created_at asc
  ) as rank,
  display_name,
  time_ms,
  logical_move_rate,
  chording_efficiency
from first_win_per_account;

comment on view public.daily_sweep_rankings is
  'Public per-Sweep_Day Daily Sweep leaderboard: each Account''s first-attempt win, fastest-first, ties by earlier submission (19.2, 19.3, 19.9).';

grant select on public.daily_sweep_rankings to anon, authenticated;

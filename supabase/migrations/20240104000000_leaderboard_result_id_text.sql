-- ---------------------------------------------------------------------------
-- 20240104000000_leaderboard_result_id_text
--
-- Fix: leaderboard submissions failed with
--   "invalid input syntax for type uuid: gen-...-v1-..."
-- because the client's game-result id is a composite STRING
-- ("<boardId>-<epochMs>"), not a uuid, and leaderboard_entries.result_id was a
-- uuid with a foreign key to game_results(id). In this build games are stored
-- in the browser (localStorage), never in game_results, so that FK could never
-- be satisfied by a client-generated id regardless.
--
-- This migration:
--   1. Drops the FK from leaderboard_entries.result_id to game_results(id).
--   2. Changes result_id from uuid to text (keeps the unique index intact, so
--      the 19.7 one-submission-per-game check still holds on the string id).
--   3. Redefines submit_leaderboard_result with p_result_id text (body
--      otherwise unchanged). A uuid overload would otherwise linger, so the old
--      signature is dropped first.
-- ---------------------------------------------------------------------------

-- 1 + 2. Drop the FK (name is auto-generated) and widen the column to text.
alter table public.leaderboard_entries
  drop constraint if exists leaderboard_entries_result_id_fkey;

alter table public.leaderboard_entries
  alter column result_id type text using result_id::text;

-- 3. Drop the old uuid-typed function so the signature change is clean.
drop function if exists public.submit_leaderboard_result(
  uuid, minelogic_difficulty, text, integer, integer, integer,
  integer, integer, numeric, numeric, boolean
);

create or replace function public.submit_leaderboard_result(
  p_result_id           text,
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
  if v_user_id is null then
    return 'not_authenticated';
  end if;

  if p_completed_practice is not true then
    return 'practice_required';
  end if;

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

  v_min_time_ms := (p_three_bv::numeric * 1000.0) / 15.0;
  if p_time_ms < v_min_time_ms then
    return 'time_too_fast';
  end if;

  if p_time_ms > 3600 * 1000 then
    return 'time_too_slow';
  end if;

  select count(*) into v_recent_count
  from public.leaderboard_entries
  where user_id = v_user_id
    and created_at > now() - interval '1 hour';
  if v_recent_count >= 30 then
    return 'rate_limited';
  end if;

  if exists (
    select 1 from public.leaderboard_entries where result_id = p_result_id
  ) then
    return 'duplicate_result';
  end if;

  insert into public.leaderboard_entries (
    user_id, difficulty, result_id, display_name,
    time_ms, three_bv, logical_move_rate, chording_efficiency
  ) values (
    v_user_id, p_difficulty, p_result_id, p_display_name,
    p_time_ms, p_three_bv, p_logical_move_rate, p_chording_efficiency
  );

  return 'ok';
exception
  when unique_violation then
    return 'duplicate_result';
end;
$$;

comment on function public.submit_leaderboard_result is
  'Runs Requirement 19.7 plausibility checks + 19.8 rate limit, inserting a leaderboard entry only if all pass; returns the failed check name or ''ok''. result_id is text (client game id).';

grant execute on function public.submit_leaderboard_result(
  text, minelogic_difficulty, text, integer, integer, integer,
  integer, integer, numeric, numeric, boolean
) to authenticated;

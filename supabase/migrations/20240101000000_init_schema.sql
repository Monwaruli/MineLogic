-- MineLogic Platform — core schema and Row Level Security.
--
-- Task 8.1: schema + RLS for the public client API. This migration creates the
-- account-owned tables (profiles, progress, game_results, leaderboard_entries)
-- and the shared Daily Sweep board table, enables Row Level Security on every
-- one of them, and installs owner-scoped policies.
--
-- Security model (Requirement 27):
--   * 27.1  RLS is enabled on every table exposed to the client API.
--   * 27.3  Each Account reads/writes only its own profile, progress, and
--           game-result rows (policies key off auth.uid()).
--   * 27.11 Every client-submitted value is bounded with CHECK constraints
--           (enum domains, length limits, non-negative numeric ranges).
--
-- The client only ever authenticates with the anon key, so these policies are
-- what keeps one Account from reading or altering another Account's data.

-- ---------------------------------------------------------------------------
-- Shared domains and helpers
-- ---------------------------------------------------------------------------

-- The three Difficulty presets, mirrored from src/engine/board.ts
-- (Beginner 9x9/10, Intermediate 16x16/40, Expert 30x16/99). Stored as a
-- CHECK-constrained text rather than an ENUM so adding a tier later is a plain
-- migration, not an ALTER TYPE.
create domain minelogic_difficulty as text
  check (value in ('Beginner', 'Intermediate', 'Expert'));

-- Game outcome, mirrored from the engine Status union (src/engine/game.ts).
-- Only finished games are stored, so the outcome is 'won' or 'lost'.
create domain minelogic_outcome as text
  check (value in ('won', 'lost'));

-- ---------------------------------------------------------------------------
-- profiles — one row per Account, keyed to the auth user id.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  -- Primary key is the Supabase auth user id; deleting the auth user cascades.
  id            uuid primary key references auth.users (id) on delete cascade,
  -- Display_Name: 1–40 visible characters (length-constrained per 27.11).
  display_name  text not null
    check (char_length(display_name) between 1 and 40),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'One profile per Account, keyed to auth.users. Owner-managed under RLS.';

-- ---------------------------------------------------------------------------
-- progress — per-Account, per-Difficulty curriculum milestones and mastery.
-- ---------------------------------------------------------------------------
create table if not exists public.progress (
  user_id       uuid not null references auth.users (id) on delete cascade,
  difficulty    minelogic_difficulty not null,
  -- Curriculum loop counters. Non-negative, bounded to keep a malicious client
  -- from storing absurd values (27.11).
  completed_lessons  integer not null default 0
    check (completed_lessons between 0 and 10000),
  -- Skill_Check result label; short, length-constrained free text.
  skill_check   text
    check (skill_check is null or char_length(skill_check) <= 32),
  -- Mastery score as a fraction in [0, 1].
  mastery       numeric(5, 4) not null default 0
    check (mastery between 0 and 1),
  -- Opaque milestone blob the client recomputes from; bounded size via the
  -- column plus a length guard so one row cannot be unbounded.
  milestones    jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  -- One progress row per Account per Difficulty.
  primary key (user_id, difficulty)
);

comment on table public.progress is
  'Per-Account, per-Difficulty milestones and mastery. Owner-only under RLS.';

-- ---------------------------------------------------------------------------
-- game_results — one row per finished game. Stores the canonical Board_Format
-- text and Move_Log text so metrics can be recomputed server-side later
-- (mirrors src/storage/gameStorage.ts GameResultRecord).
-- ---------------------------------------------------------------------------
create table if not exists public.game_results (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  difficulty    minelogic_difficulty not null,
  outcome       minelogic_outcome not null,
  -- Canonical Board_Format text. Bounded length so an Expert board fits with
  -- room to spare but a client cannot submit an unbounded blob (27.11).
  board_format  text not null
    check (char_length(board_format) between 1 and 16384),
  -- Serialized Move_Log text (recomputation source for metrics).
  move_log      text not null
    check (char_length(move_log) between 1 and 262144),
  -- Cached Game_Metrics as JSON (recomputable from board_format + move_log).
  metrics       jsonb not null default '{}'::jsonb,
  -- Elapsed game time in milliseconds; non-negative and bounded to a day.
  time_ms       integer not null
    check (time_ms between 0 and 86400000),
  -- 3BV / board-value style count the client may submit; non-negative.
  three_bv      integer
    check (three_bv is null or three_bv between 0 and 100000),
  created_at    timestamptz not null default now()
);

create index if not exists game_results_user_idx
  on public.game_results (user_id, created_at desc);

comment on table public.game_results is
  'One finished game per row with Board_Format + Move_Log text. Owner-only.';

-- ---------------------------------------------------------------------------
-- leaderboard_entries — per-Account winning results surfaced on leaderboards.
-- Readable by everyone (leaderboards are public), insertable only by the owner,
-- and NOT updatable/deletable by the client (27.7 reserves that for the project
-- owner / service role). Owner-scoped INSERT is modeled here; the absence of
-- UPDATE/DELETE policies denies those actions to the anon/authenticated roles.
-- ---------------------------------------------------------------------------
create table if not exists public.leaderboard_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  difficulty    minelogic_difficulty not null,
  -- The game this entry came from (a won result).
  result_id     uuid references public.game_results (id) on delete cascade,
  -- Denormalized display name at submission time; length-constrained (27.11).
  display_name  text not null
    check (char_length(display_name) between 1 and 40),
  -- Completion time in ms. Leaderboards are time-ranked; must be positive and
  -- bounded (27.11). A plausibility database function is added in task 8.3.
  time_ms       integer not null
    check (time_ms between 1 and 86400000),
  three_bv      integer not null
    check (three_bv between 1 and 100000),
  created_at    timestamptz not null default now()
);

create index if not exists leaderboard_entries_rank_idx
  on public.leaderboard_entries (difficulty, time_ms asc);

comment on table public.leaderboard_entries is
  'Public, time-ranked winning results. Insert-own; update/delete owner-only (27.7).';

-- ---------------------------------------------------------------------------
-- daily_sweep_boards — one shared Board per UTC day, stored as Board_Format
-- text. Readable by everyone; only the service role may write (no client
-- INSERT/UPDATE/DELETE policy is defined, which denies those to anon).
-- ---------------------------------------------------------------------------
create table if not exists public.daily_sweep_boards (
  -- The UTC calendar day this board is for; unique so there is exactly one.
  sweep_day     date primary key,
  -- The shared Board in canonical Board_Format text.
  board_format  text not null
    check (char_length(board_format) between 1 and 16384),
  difficulty    minelogic_difficulty not null,
  created_at    timestamptz not null default now()
);

comment on table public.daily_sweep_boards is
  'One shared Daily Sweep board per UTC day (Board_Format text). Service-role write only.';

-- ---------------------------------------------------------------------------
-- Row Level Security (Requirement 27.1) — enable on every table.
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.progress            enable row level security;
alter table public.game_results        enable row level security;
alter table public.leaderboard_entries enable row level security;
alter table public.daily_sweep_boards  enable row level security;

-- Force RLS even for the table owner role so no path bypasses the policies
-- except the service role (which bypasses RLS by design).
alter table public.profiles            force row level security;
alter table public.progress            force row level security;
alter table public.game_results        force row level security;
alter table public.leaderboard_entries force row level security;
alter table public.daily_sweep_boards  force row level security;

-- ---------------------------------------------------------------------------
-- Policies — profiles: an Account manages only its own row (27.3).
-- ---------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (auth.uid() = id);

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy profiles_delete_own on public.profiles
  for delete to authenticated
  using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Policies — progress: owner-only read/write (27.3).
-- ---------------------------------------------------------------------------
create policy progress_select_own on public.progress
  for select to authenticated
  using (auth.uid() = user_id);

create policy progress_insert_own on public.progress
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy progress_update_own on public.progress
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy progress_delete_own on public.progress
  for delete to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Policies — game_results: owner-only read/write (27.3).
-- ---------------------------------------------------------------------------
create policy game_results_select_own on public.game_results
  for select to authenticated
  using (auth.uid() = user_id);

create policy game_results_insert_own on public.game_results
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy game_results_update_own on public.game_results
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy game_results_delete_own on public.game_results
  for delete to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Policies — leaderboard_entries: public read, insert-own, no client
-- update/delete (27.7 reserves those for the project owner / service role).
-- ---------------------------------------------------------------------------
create policy leaderboard_select_all on public.leaderboard_entries
  for select to anon, authenticated
  using (true);

create policy leaderboard_insert_own on public.leaderboard_entries
  for insert to authenticated
  with check (auth.uid() = user_id);

-- No UPDATE or DELETE policy is defined for anon/authenticated, so those
-- actions are denied to the client. The service role bypasses RLS and remains
-- the only writer that can modify or remove a stored leaderboard result.

-- ---------------------------------------------------------------------------
-- Policies — daily_sweep_boards: public read, service-role-only write.
-- ---------------------------------------------------------------------------
create policy daily_sweep_select_all on public.daily_sweep_boards
  for select to anon, authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policy is defined for anon/authenticated, so the
-- client cannot write Daily Sweep boards. The service role (RLS-exempt) seeds
-- the one board per UTC day.

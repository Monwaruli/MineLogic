-- MineLogic Platform — accounts and progress sync (task 8.2).
--
-- This follow-up migration (it does NOT edit 20240101000000_init_schema.sql)
-- adds the two schema pieces that accounts + progress sync need:
--
--   1. A case-insensitive UNIQUE constraint on the Display_Name, so that no two
--      Accounts can use the same name (Requirement 20.4). The init migration
--      already length-checks display_name (1-40); task 8.2 additionally requires
--      a Display_Name of 3-20 characters using only letters, digits, underscores,
--      and hyphens, which the client validates (see src/storage/authService.ts).
--      Uniqueness, however, must be enforced by the Backend, so it lives here.
--
--   2. A completed_sweep_days table: one row per Account per completed UTC Sweep
--      day (Requirement 20.8 — store completed Sweep_Days in the Backend). The
--      stable key (user_id, sweep_day) makes re-delivery of a Sync_Queue write
--      idempotent (Requirement 20.10): inserting the same completion twice is a
--      no-op via ON CONFLICT DO NOTHING / upsert.
--
-- Owner-only RLS mirrors the init migration: policies key off auth.uid().

-- ---------------------------------------------------------------------------
-- 1. Unique, case-insensitive Display_Name.
-- ---------------------------------------------------------------------------
-- A functional unique index on lower(display_name) treats "Alice" and "alice"
-- as the same name, matching the client-side normalization in authService.ts.
-- A duplicate insert/update raises a unique-violation the client surfaces as a
-- "display name already taken" error (Requirement 20.4).
create unique index if not exists profiles_display_name_unique_idx
  on public.profiles (lower(display_name));

-- ---------------------------------------------------------------------------
-- 2. completed_sweep_days — one row per Account per completed UTC Sweep day.
-- ---------------------------------------------------------------------------
create table if not exists public.completed_sweep_days (
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- The UTC calendar day the Account completed. Matches daily_sweep_boards.sweep_day.
  sweep_day  date not null,
  -- Completion time in ms for that day's board; non-negative and bounded (27.11).
  time_ms    integer not null
    check (time_ms between 0 and 86400000),
  created_at timestamptz not null default now(),
  -- Stable key: one completion per Account per day. This is what makes a
  -- re-delivered Sync_Queue write idempotent (Requirement 20.10).
  primary key (user_id, sweep_day)
);

create index if not exists completed_sweep_days_user_idx
  on public.completed_sweep_days (user_id, sweep_day desc);

comment on table public.completed_sweep_days is
  'One row per Account per completed UTC Sweep day. Owner-only under RLS; (user_id, sweep_day) key makes sync re-delivery idempotent.';

-- ---------------------------------------------------------------------------
-- Row Level Security — enable + force, then owner-only policies.
-- ---------------------------------------------------------------------------
alter table public.completed_sweep_days enable row level security;
alter table public.completed_sweep_days force row level security;

create policy completed_sweep_days_select_own on public.completed_sweep_days
  for select to authenticated
  using (auth.uid() = user_id);

create policy completed_sweep_days_insert_own on public.completed_sweep_days
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy completed_sweep_days_update_own on public.completed_sweep_days
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy completed_sweep_days_delete_own on public.completed_sweep_days
  for delete to authenticated
  using (auth.uid() = user_id);

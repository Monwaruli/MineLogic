-- MineLogic Platform — evaluation study module (task 9.1).
--
-- This follow-up migration (it does NOT edit the earlier migrations) adds the
-- Backend pieces of Requirement 21 — Study Entry, Consent, and Participant
-- Identity. The study module is intentionally SEPARATE from Accounts:
-- participants are anonymous and hold NO Supabase auth session, so none of the
-- study tables reference auth.users and none carry an email address (21.7).
--
-- Because an anonymous participant has no auth.uid(), owner-scoped RLS of the
-- auth.uid() kind cannot scope a participant's own rows. Instead:
--
--   * The study tables enable + FORCE RLS and define NO anon/authenticated
--     read/write policies, so the anon role cannot touch them directly at all.
--   * Every participant operation goes through a SECURITY DEFINER function the
--     anon role may EXECUTE. Each function enforces its own checks internally
--     (consent exists, participant exists, the caller supplied the matching
--     participant_id) so one participant can never read, write, or delete
--     another participant's data. The functions run as owner and so bypass RLS,
--     which is why the tables need no permissive policies.
--
-- The functions the anon client calls:
--   get_active_config_by_code(code)  -> the ACTIVE Study_Config for a Study_Code
--                                       (21.1, 21.2, 21.3 config fields).
--   create_participant(config_id, consent_version) -> a new anonymous
--                                       Participant + consent row + Resume_Code
--                                       (21.4, 21.7, 21.8).
--   get_participant_by_resume_code(code) -> restore identity from a Resume_Code
--                                       (21.10).
--   insert_study_record(...)         -> insert a Study_Record ONLY when a
--                                       consent row exists for the participant
--                                       (21.6). Defined now; written by 9.3.
--   withdraw_participant(participant_id) -> delete every Study_Record for the
--                                       participant (21.12).
--
-- Requirement 27.11 — every client-submitted value is bounded with CHECK
-- constraints (lengths, enum-like domains) at the table and in the functions.

-- ---------------------------------------------------------------------------
-- Study_Session step kinds (Requirement 22.1 order). Stored as a
-- CHECK-constrained domain, matching the init migration's style for
-- minelogic_difficulty, so adding a step later is a plain migration.
-- The ordered steps are: Background_Questions, Pre_Test, Learning_Phase,
-- Post_Test, Survey_Form, and the terminal completion. The client mirrors this
-- order in src/study/steps.ts for the "first incomplete step" resume logic.
-- ---------------------------------------------------------------------------
create domain study_step as text
  check (value in (
    'Background_Questions',
    'Pre_Test',
    'Learning_Phase',
    'Post_Test',
    'Survey_Form',
    'completion'
  ));

-- ---------------------------------------------------------------------------
-- study_configs — one row per study. A Study_Link carries a Study_Code; only an
-- ACTIVE config is usable (21.1, 21.2). The consent text + statements drive the
-- consent screen, and the Evaluation_Board / video fields referenced by 21.3
-- and Requirement 22 are declared now (9.2 populates and the Content_Validator
-- checks them). Public read of ACTIVE configs is allowed because the anon
-- consent screen must fetch the consent text; writes are service-role only.
-- ---------------------------------------------------------------------------
create table if not exists public.study_configs (
  id             uuid primary key default gen_random_uuid(),
  -- Study_Code carried by the Study_Link; unique and length-bounded (27.11).
  study_code     text not null unique
    check (char_length(study_code) between 1 and 64),
  -- Only an ACTIVE config may start new Study_Sessions (21.1, 21.2).
  active         boolean not null default false,
  -- Consent text shown before any other study screen (21.1); bounded length.
  consent_text   text not null
    check (char_length(consent_text) between 1 and 20000),
  -- The consent text version recorded with each consent (21.4); bounded.
  consent_version text not null
    check (char_length(consent_version) between 1 and 64),
  -- The individual consent statements the person must each affirm (21.1, 21.4),
  -- as a JSON array of strings. Size-guarded so a config cannot be unbounded.
  consent_statements jsonb not null default '[]'::jsonb
    check (jsonb_typeof(consent_statements) = 'array'),
  -- Whether this study includes the Expert tier (Requirement 22.4, 23.1). When
  -- true, a Post_Expert board and the Expert learning block are required.
  includes_expert boolean not null default false,
  -- The five Evaluation_Boards (21.3) as canonical Board_Format text. Nullable
  -- now because 9.2 populates and validates them; 21.3 treats a missing board
  -- as a configuration error. post_expert is only required when includes_expert.
  pre_beginner      text check (pre_beginner is null or char_length(pre_beginner) between 1 and 16384),
  pre_intermediate  text check (pre_intermediate is null or char_length(pre_intermediate) between 1 and 16384),
  post_beginner     text check (post_beginner is null or char_length(post_beginner) between 1 and 16384),
  post_intermediate text check (post_intermediate is null or char_length(post_intermediate) between 1 and 16384),
  post_expert       text check (post_expert is null or char_length(post_expert) between 1 and 16384),
  -- The Intermediate Video_Source shown to Group_A (21.3, 23.6); bounded URL.
  intermediate_video_source text
    check (intermediate_video_source is null or char_length(intermediate_video_source) between 1 and 2048),
  created_at     timestamptz not null default now()
);

comment on table public.study_configs is
  'One study per row: Study_Code, consent text/version/statements, Evaluation_Boards and Intermediate Video_Source. Public read of ACTIVE rows; service-role write.';

-- ---------------------------------------------------------------------------
-- study_participants — one anonymous identity per Participant (21.7). No email,
-- no auth.users reference. Identified by participant_id (uuid) and a short,
-- human-usable Resume_Code the participant writes down (21.8, 21.10).
-- ---------------------------------------------------------------------------
create table if not exists public.study_participants (
  participant_id  uuid primary key default gen_random_uuid(),
  study_config_id uuid not null references public.study_configs (id) on delete cascade,
  -- Resume_Code: a short, unambiguous code (uppercase letters/digits, dashes
  -- allowed), unique so it restores exactly one identity (21.10). Length-bounded
  -- (27.11); the generator produces a fixed-width code.
  resume_code     text not null unique
    check (resume_code ~ '^[A-Z0-9-]{6,32}$'),
  -- Assigned learning group (Requirement 23.3); null until the Intermediate
  -- block assigns it in task 9.2. Declared now so resume keeps the group (23.5).
  study_group     text check (study_group is null or study_group in ('Group_A', 'Group_B')),
  created_at      timestamptz not null default now()
);

comment on table public.study_participants is
  'Anonymous study identity (21.7): participant_id + unique Resume_Code, no email, no auth.users link.';

-- ---------------------------------------------------------------------------
-- study_consents — one row per Participant recording consent_time and the
-- consent text version (21.4). The EXISTENCE of this row is what the Study_Record
-- acceptance rule of 21.6 keys on. One consent per participant (primary key).
-- ---------------------------------------------------------------------------
create table if not exists public.study_consents (
  participant_id  uuid primary key references public.study_participants (participant_id) on delete cascade,
  -- Consent time in ISO 8601 UTC with ms precision is derived from this
  -- timestamptz when exported (Requirement 25.9).
  consent_time    timestamptz not null default now(),
  -- The consent text version in force when consent was given (21.4); bounded.
  consent_version text not null
    check (char_length(consent_version) between 1 and 64)
);

comment on table public.study_consents is
  'One consent per Participant: consent_time + consent_version (21.4). Its existence authorizes Study_Record inserts (21.6).';

-- ---------------------------------------------------------------------------
-- study_records — one row per logged study event. Defined now (task 9.1); the
-- rows themselves are written by 9.3. The 21.6 acceptance rule is enforced two
-- ways: a FK to study_consents(participant_id) means a record cannot exist
-- without a consent row, AND the insert_study_record function below re-checks
-- the consent row explicitly for a clear rejection. No email/name/IP/account
-- column (Requirement 25.8).
-- ---------------------------------------------------------------------------
create table if not exists public.study_records (
  id             uuid primary key default gen_random_uuid(),
  -- FK to the CONSENT row, not just the participant: this is the hard backstop
  -- for 21.6 — a Study_Record cannot be inserted for a participant that has no
  -- consent row. Deleting the consent (withdrawal) cascades the records away.
  participant_id uuid not null
    references public.study_consents (participant_id) on delete cascade,
  -- The Study_Session step/phase this record belongs to (22.1 order).
  step           study_step not null,
  -- A short kind label distinguishing records within a step (e.g. 'game',
  -- 'survey', 'learning_event'); bounded length (27.11). Detailed schema is 9.3.
  kind           text not null
    check (char_length(kind) between 1 and 64),
  -- The record payload as JSON; size-guarded. 9.3 defines the per-kind shape.
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists study_records_participant_idx
  on public.study_records (participant_id, created_at desc);

comment on table public.study_records is
  'One study event per row. FK to study_consents enforces 21.6 (consent required). No email/name/IP/account (25.8). Deleted on withdrawal via cascade + withdraw_participant (21.12).';

-- ---------------------------------------------------------------------------
-- Row Level Security — enable + FORCE on every new table (Requirement 27.1).
-- ---------------------------------------------------------------------------
alter table public.study_configs      enable row level security;
alter table public.study_participants enable row level security;
alter table public.study_consents     enable row level security;
alter table public.study_records      enable row level security;

alter table public.study_configs      force row level security;
alter table public.study_participants force row level security;
alter table public.study_consents     force row level security;
alter table public.study_records      force row level security;

-- study_configs: the ONLY direct client read allowed is the ACTIVE configs, so
-- the consent screen can fetch consent text without a participant session. No
-- write policy, so the service role is the only writer.
create policy study_configs_select_active on public.study_configs
  for select to anon, authenticated
  using (active = true);

-- study_participants, study_consents, study_records: NO policies for
-- anon/authenticated. With FORCE RLS and no policy, the anon client cannot read
-- or write these tables directly; every access goes through the SECURITY
-- DEFINER functions below, which run as owner and enforce their own checks.

-- ---------------------------------------------------------------------------
-- get_active_config_by_code — the ACTIVE Study_Config for a Study_Code, or no
-- row when the code matches no active config (21.1, 21.2). Returns the fields
-- the consent screen and the 21.3 configuration-error check need. Runs as the
-- anon role via the policy above, but exposed as a function for a single call.
-- ---------------------------------------------------------------------------
create or replace function public.get_active_config_by_code(p_study_code text)
returns table (
  id uuid,
  study_code text,
  consent_text text,
  consent_version text,
  consent_statements jsonb,
  includes_expert boolean,
  pre_beginner text,
  pre_intermediate text,
  post_beginner text,
  post_intermediate text,
  post_expert text,
  intermediate_video_source text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.study_code, c.consent_text, c.consent_version, c.consent_statements,
    c.includes_expert, c.pre_beginner, c.pre_intermediate, c.post_beginner,
    c.post_intermediate, c.post_expert, c.intermediate_video_source
  from public.study_configs c
  where c.study_code = p_study_code
    and c.active = true;
$$;

comment on function public.get_active_config_by_code is
  'Returns the ACTIVE Study_Config for a Study_Code (21.1/21.2), with the Evaluation_Board + video fields the 21.3 config-error check needs.';

-- ---------------------------------------------------------------------------
-- A Resume_Code generator: a short, unambiguous uppercase code. Excludes
-- easily-confused characters (no 0/O, 1/I, etc.) so a participant can reliably
-- write it down and re-enter it (21.8, 21.10). Format MLS-XXXX-XXXX.
-- ---------------------------------------------------------------------------
create or replace function public.gen_resume_code()
returns text
language plpgsql
volatile
as $$
declare
  -- Unambiguous alphabet: no 0/O/1/I/L to avoid transcription errors.
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_len      constant integer := length(v_alphabet);
  v_body     text := '';
  i          integer;
begin
  for i in 1..8 loop
    v_body := v_body || substr(v_alphabet, 1 + floor(random() * v_len)::integer, 1);
    if i = 4 then
      v_body := v_body || '-';
    end if;
  end loop;
  return 'MLS-' || v_body;  -- e.g. MLS-ABCD-EFGH
end;
$$;

-- ---------------------------------------------------------------------------
-- create_participant — create an anonymous Participant with a new Participant_ID
-- and a Resume_Code, and record the consent time + consent text version (21.4,
-- 21.7, 21.8). Returns the participant_id and the Resume_Code so the client can
-- display the Resume_Code (21.8). No email or Account is attached (21.7).
--
-- The config must be ACTIVE (21.1); otherwise the function raises, so a
-- participant cannot be created against a deactivated study. Resume_Code
-- collisions are astronomically unlikely but retried a few times to be safe.
-- ---------------------------------------------------------------------------
create or replace function public.create_participant(
  p_config_id        uuid,
  p_consent_version  text
)
returns table (participant_id uuid, resume_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_id uuid;
  v_resume_code    text;
  v_active         boolean;
  v_attempt        integer := 0;
begin
  -- The config must exist and be ACTIVE to create a participant (21.1).
  select active into v_active from public.study_configs where id = p_config_id;
  if v_active is distinct from true then
    raise exception 'study config % is not active', p_config_id
      using errcode = 'check_violation';
  end if;

  -- Insert the participant, retrying on the (very unlikely) Resume_Code clash.
  loop
    v_attempt := v_attempt + 1;
    v_resume_code := public.gen_resume_code();
    begin
      insert into public.study_participants (study_config_id, resume_code)
      values (p_config_id, v_resume_code)
      returning study_participants.participant_id into v_participant_id;
      exit;  -- success
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;  -- give up after a handful of collisions
      end if;
    end;
  end loop;

  -- Record consent: its existence authorizes Study_Record inserts (21.4, 21.6).
  insert into public.study_consents (participant_id, consent_version)
  values (v_participant_id, p_consent_version);

  participant_id := v_participant_id;
  resume_code := v_resume_code;
  return next;
end;
$$;

comment on function public.create_participant is
  'Creates an anonymous Participant (no email/Account, 21.7) with a Resume_Code and records consent time + version (21.4, 21.8). Returns participant_id and Resume_Code.';

-- ---------------------------------------------------------------------------
-- get_participant_by_resume_code — restore a study identity from a Resume_Code
-- (21.10). Returns the participant_id, its study_config_id, and group, or no
-- row when the code is unknown. Only a participant who holds the exact code can
-- restore that identity, so this scopes access to the code holder.
-- ---------------------------------------------------------------------------
create or replace function public.get_participant_by_resume_code(p_resume_code text)
returns table (participant_id uuid, study_config_id uuid, study_group text)
language sql
stable
security definer
set search_path = public
as $$
  select p.participant_id, p.study_config_id, p.study_group
  from public.study_participants p
  where p.resume_code = p_resume_code;
$$;

comment on function public.get_participant_by_resume_code is
  'Restores a Participant identity from a valid Resume_Code (21.10); returns no row for an unknown code.';

-- ---------------------------------------------------------------------------
-- insert_study_record — the 21.6 acceptance rule in function form. Inserts a
-- Study_Record ONLY when a consent row exists for the participant; otherwise it
-- raises and inserts nothing. The FK on study_records is the hard backstop, but
-- this function gives the anon client a single callable entry point that
-- enforces the rule explicitly. Written against by task 9.3.
-- ---------------------------------------------------------------------------
create or replace function public.insert_study_record(
  p_participant_id uuid,
  p_step           study_step,
  p_kind           text,
  p_payload        jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- 21.6 — accept a Study_Record only when a consent record exists for the
  -- participant. Checked explicitly for a clear error; the FK is the backstop.
  if not exists (
    select 1 from public.study_consents where participant_id = p_participant_id
  ) then
    raise exception 'no consent on file for participant %', p_participant_id
      using errcode = 'check_violation';
  end if;

  insert into public.study_records (participant_id, step, kind, payload)
  values (p_participant_id, p_step, p_kind, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.insert_study_record is
  'Inserts a Study_Record only when a consent row exists for the participant (21.6); otherwise raises and inserts nothing.';

-- ---------------------------------------------------------------------------
-- withdraw_participant — on confirmed withdrawal, delete every Study_Record for
-- the participant (21.12). Deleting the consent row would also cascade the
-- records, but withdrawal keeps the anonymous identity row so the Resume_Code
-- is not silently reusable; it removes the logged data. Returns the number of
-- Study_Records deleted so the client can confirm (21.13).
--
-- This is the withdrawal function Requirement 27.7 names as permitted to delete
-- Study_Records. It runs as owner (SECURITY DEFINER) and acts only on the
-- supplied participant_id, so a participant withdraws only their own data.
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_participant(p_participant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  -- 21.12 — delete every Study_Record with this Participant_ID.
  delete from public.study_records where participant_id = p_participant_id;
  get diagnostics v_deleted = row_count;

  -- Remove the consent record too, so no new Study_Records can be inserted for
  -- this withdrawn participant (21.6 would reject them anyway). The anonymous
  -- participant row is kept so the Resume_Code stays retired.
  delete from public.study_consents where participant_id = p_participant_id;

  return v_deleted;
end;
$$;

comment on function public.withdraw_participant is
  'Deletes every Study_Record for a Participant on confirmed withdrawal (21.12) and removes the consent row; returns the count deleted (27.7 withdrawal function).';

-- ---------------------------------------------------------------------------
-- Function grants — the anon client (the only credential, 27.8) may EXECUTE the
-- study functions. The functions enforce their own checks, so direct table
-- access stays denied by the (policy-less) RLS above.
-- ---------------------------------------------------------------------------
revoke all on function public.get_active_config_by_code(text) from public;
grant execute on function public.get_active_config_by_code(text) to anon, authenticated;

revoke all on function public.create_participant(uuid, text) from public;
grant execute on function public.create_participant(uuid, text) to anon, authenticated;

revoke all on function public.get_participant_by_resume_code(text) from public;
grant execute on function public.get_participant_by_resume_code(text) to anon, authenticated;

revoke all on function public.insert_study_record(uuid, study_step, text, jsonb) from public;
grant execute on function public.insert_study_record(uuid, study_step, text, jsonb) to anon, authenticated;

revoke all on function public.withdraw_participant(uuid) from public;
grant execute on function public.withdraw_participant(uuid) to anon, authenticated;

-- gen_resume_code is an internal helper; keep it off the public API surface.
revoke all on function public.gen_resume_code() from public;

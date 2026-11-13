-- MineLogic Platform — study logging config + anonymized data export (task 9.3).
--
-- A follow-up migration (it does NOT edit the earlier migrations) that adds the
-- Backend pieces of Requirements 24, 25, and 26 that live in the database:
--
--   * Survey item text on study_configs so the Survey_Form reads its items from
--     the Study_Config (24.2), and an updated get_active_config_by_code that
--     returns them.
--   * A Researcher role (a researchers table keyed to auth.users) that only the
--     project owner may populate through the Supabase dashboard / service role
--     (27.6), plus read-access to study data gated so ONLY a Researcher may read
--     other Participants' Study_Records (27.5) — a non-Researcher export request
--     is DENIED (26.2). The export reads are SECURITY DEFINER functions that
--     check the caller is a Researcher before returning any data.
--
-- The anonymous study-write model from 20240104 is unchanged: participants hold
-- no auth session and still write only through insert_study_record. The export
-- side is the opposite: a Researcher is a signed-in Account (auth.uid()) whose
-- membership in the researchers set unlocks the read-only export functions.
--
-- 25.8 is preserved: study_records still has no email/name/IP/account column,
-- and the export functions never join to any identifying field, so an export
-- carries only anonymous Participant_IDs and study data.

-- ---------------------------------------------------------------------------
-- Survey item text on study_configs (Requirement 24.1, 24.2).
--
-- The Survey_Form presents seven 5-point rating items, then three open-ended
-- prompts, then one demographics item (24.1), with the text read from the
-- Study_Config (24.2). We store the rating items and open prompts as JSON
-- arrays of strings and the demographics item as text. All are nullable: when a
-- config omits them the client falls back to its default wording, so the survey
-- still renders the required shape. Size/shape guarded per 27.11.
-- ---------------------------------------------------------------------------
alter table public.study_configs
  add column if not exists survey_rating_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(survey_rating_items) = 'array'),
  add column if not exists survey_open_prompts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(survey_open_prompts) = 'array'),
  add column if not exists survey_demographics_item text
    check (survey_demographics_item is null or char_length(survey_demographics_item) between 1 and 2000);

comment on column public.study_configs.survey_rating_items is
  'Survey_Form rating item text as a JSON array of strings (24.1/24.2); client uses defaults when empty.';

-- Replace get_active_config_by_code so it also returns the survey item text the
-- Survey_Form needs (24.2). The return shape is extended; the client reads the
-- new fields and falls back to defaults when they are empty.
drop function if exists public.get_active_config_by_code(text);

create function public.get_active_config_by_code(p_study_code text)
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
  intermediate_video_source text,
  survey_rating_items jsonb,
  survey_open_prompts jsonb,
  survey_demographics_item text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.study_code, c.consent_text, c.consent_version, c.consent_statements,
    c.includes_expert, c.pre_beginner, c.pre_intermediate, c.post_beginner,
    c.post_intermediate, c.post_expert, c.intermediate_video_source,
    c.survey_rating_items, c.survey_open_prompts, c.survey_demographics_item
  from public.study_configs c
  where c.study_code = p_study_code
    and c.active = true;
$$;

comment on function public.get_active_config_by_code is
  'Returns the ACTIVE Study_Config for a Study_Code (21.1/21.2), including the Survey_Form item text (24.2).';

revoke all on function public.get_active_config_by_code(text) from public;
grant execute on function public.get_active_config_by_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- researchers — the Researcher role (Requirement 27.5, 27.6). One row per
-- Account that may export study data. Populated ONLY by the project owner via
-- the Supabase dashboard / service role: FORCE RLS with NO insert/update/delete
-- policy means no client (anon or authenticated) can add themselves, so the
-- service role is the only writer (27.6).
-- ---------------------------------------------------------------------------
create table if not exists public.researchers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.researchers is
  'Accounts granted the Researcher role (27.5). Populated only by the project owner via the service role (27.6).';

alter table public.researchers enable row level security;
alter table public.researchers force row level security;

-- A signed-in Account may read ONLY its own researcher row, so the client can
-- tell whether to show the export controls. No one may write via the client.
create policy researchers_select_self on public.researchers
  for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- is_researcher — true when the current caller is a Researcher. Used by the
-- export functions to enforce 26.2 / 27.5. STABLE + SECURITY DEFINER so it can
-- read the researchers table regardless of the caller's own RLS view.
-- ---------------------------------------------------------------------------
create or replace function public.is_researcher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.researchers r where r.user_id = auth.uid()
  );
$$;

comment on function public.is_researcher is
  'True when the current Account is a Researcher (27.5); the export functions gate on it (26.2).';

revoke all on function public.is_researcher() from public;
grant execute on function public.is_researcher() to authenticated;

-- ---------------------------------------------------------------------------
-- Export reads (Requirement 26.1, 26.2, 27.5). Each is a SECURITY DEFINER
-- function that FIRST checks the caller is a Researcher and RAISES (denies)
-- otherwise, so a non-Researcher export request is refused (26.2). Each returns
-- anonymized rows carrying only the Participant_ID and study data (25.8) — no
-- email/name/IP/account is ever joined in.
--
-- The functions return the raw Study_Records for each category; the client's
-- Data_Exporter shapes them into the separate CSVs (26.1) and the paired
-- pre/post rows (26.5). Keeping the shaping in the pure client exporter lets the
-- round-trip property (26.4) be tested without a live database.
-- ---------------------------------------------------------------------------

-- Guard helper: raise a clear "denied" error unless the caller is a Researcher.
create or replace function public.require_researcher()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_researcher() then
    raise exception 'export denied: Researcher role required'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function public.require_researcher() from public;
grant execute on function public.require_researcher() to authenticated;

-- export_participants — one row per Participant with its group and the
-- Background_Question answers (26.1). The Background answers come from the
-- Participant's 'background' Study_Record payload.
create or replace function public.export_participants()
returns table (
  participant_id uuid,
  study_group text,
  background jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_researcher();
  return query
    select
      p.participant_id,
      p.study_group,
      coalesce(
        (select rec.payload -> 'answers'
           from public.study_records rec
          where rec.participant_id = p.participant_id
            and rec.kind = 'background'
          order by rec.created_at desc
          limit 1),
        '{}'::jsonb
      ) as background
    from public.study_participants p
    -- Only participants who have at least consented (and thus can have records).
    where exists (
      select 1 from public.study_consents c where c.participant_id = p.participant_id
    );
end;
$$;

-- export_study_records — every Study_Record of a given kind, for the Researcher
-- to shape client-side (26.1, 26.5). The kind filter lets the client pull test
-- games, learning events, video events, and survey responses separately.
create or replace function public.export_study_records(p_kind text)
returns table (
  participant_id uuid,
  step study_step,
  kind text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_researcher();
  return query
    select r.participant_id, r.step, r.kind, r.payload, r.created_at
    from public.study_records r
    where r.kind = p_kind
    order by r.participant_id, r.created_at;
end;
$$;

comment on function public.export_study_records is
  'Returns Study_Records of one kind for a Researcher to export (26.1). Denies non-Researchers (26.2). Anonymous: Participant_ID + study data only (25.8).';

revoke all on function public.export_participants() from public;
grant execute on function public.export_participants() to authenticated;

revoke all on function public.export_study_records(text) from public;
grant execute on function public.export_study_records(text) to authenticated;

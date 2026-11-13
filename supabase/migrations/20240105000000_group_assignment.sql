-- MineLogic Platform — balanced Group_A / Group_B assignment (task 9.2).
--
-- This follow-up migration (it does NOT edit the earlier migrations) adds the
-- Backend piece of Requirement 23.3/23.4: when a Participant WITHOUT a group
-- reaches the Intermediate learning block, the Backend assigns them to the
-- group with fewer assigned Participants, breaking a tie at random, and keeps
-- the two group counts balanced to within one even under CONCURRENT requests.
--
-- Balance under concurrency (23.4) is the hard part. Two requests that both
-- read "A=5, B=5" must not both pick the same group and leave A=7, B=5. We make
-- the counting + decision + write a single atomic critical section guarded by a
-- transaction-scoped advisory lock (pg_advisory_xact_lock). Every caller takes
-- the SAME lock key before counting, so assignments serialize: each one sees
-- the committed result of the previous one. The lock is released automatically
-- when the transaction (the function call) commits, so there is no leak.
--
-- Idempotent resume (23.5): if the participant already HAS a group, the
-- function returns it unchanged and makes no new assignment, so resuming never
-- disturbs the balance.
--
-- The function is SECURITY DEFINER and granted to anon/authenticated (the anon
-- key is the only credential participants hold, 27.8). It enforces its own
-- checks: it assigns only for a REAL participant that currently exists, so a
-- caller cannot inflate a group by passing a bogus id.

-- A fixed key for the assignment advisory lock. Any constant works as long as
-- every assignment call uses the same one; this value namespaces the lock to
-- this feature so it will not collide with other advisory locks.
-- (Chosen arbitrarily; kept as a literal in the single call site below.)

create or replace function public.assign_participant_group(p_participant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
  v_count_a  integer;
  v_count_b  integer;
  v_group    text;
begin
  -- The participant must really exist; otherwise refuse (internal check so a
  -- caller cannot assign for a bogus id, 27.11 / least privilege).
  select study_group
    into v_existing
    from public.study_participants
   where participant_id = p_participant_id;

  if not found then
    raise exception 'unknown participant %', p_participant_id
      using errcode = 'check_violation';
  end if;

  -- 23.5 — a participant that already has a group keeps it; resuming is a no-op.
  if v_existing is not null then
    return v_existing;
  end if;

  -- 23.4 — serialize all assignments behind one transaction-scoped advisory
  -- lock so concurrent callers each see the previous assignment's committed
  -- effect. The lock releases at commit; no explicit unlock is needed.
  perform pg_advisory_xact_lock(hashtext('minelogic.study.group_assignment'));

  -- Re-check inside the lock: another concurrent call may have assigned this
  -- same participant between our first read and acquiring the lock.
  select study_group
    into v_existing
    from public.study_participants
   where participant_id = p_participant_id;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Count the current assignments under the lock, so the counts are stable for
  -- the decision below.
  select
    count(*) filter (where study_group = 'Group_A'),
    count(*) filter (where study_group = 'Group_B')
    into v_count_a, v_count_b
    from public.study_participants;

  -- 23.3 — assign to the smaller group; on a tie choose at random. Picking the
  -- smaller group keeps |A - B| <= 1 after every assignment (23.4): the only
  -- way the counts differ is by one, and we always add to the smaller side.
  if v_count_a < v_count_b then
    v_group := 'Group_A';
  elsif v_count_b < v_count_a then
    v_group := 'Group_B';
  else
    v_group := case when random() < 0.5 then 'Group_A' else 'Group_B' end;
  end if;

  update public.study_participants
     set study_group = v_group
   where participant_id = p_participant_id;

  return v_group;
end;
$$;

comment on function public.assign_participant_group is
  'Assigns a Participant without a group to the smaller of Group_A/Group_B (random tie-break), idempotent on resume (23.5), and balanced under concurrency via a transaction-scoped advisory lock (23.3/23.4).';

-- The anon client (the only credential, 27.8) may EXECUTE the assignment
-- function; the function enforces its own checks, so direct table writes stay
-- denied by the policy-less RLS from the 9.1 migration.
revoke all on function public.assign_participant_group(uuid) from public;
grant execute on function public.assign_participant_group(uuid) to anon, authenticated;

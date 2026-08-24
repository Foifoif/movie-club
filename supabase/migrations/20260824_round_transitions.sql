-- Round creation and phase transition functions.
-- These are admin/service-role operations. They are not granted to anon.

create or replace function public.mc_next_phase_type(p_phase_type text)
returns text
language sql
immutable
as $$
  select case p_phase_type
    when 'CATEGORY_SUBMISSIONS' then 'CATEGORY_SPIN'
    when 'CATEGORY_SPIN' then 'MOVIE_SUBMISSIONS'
    when 'MOVIE_SUBMISSIONS' then 'BRACKET'
    else null
  end;
$$;

create or replace function public.mc_next_9am_pacific(p_from timestamptz default now())
returns timestamptz
language sql
stable
as $$
  select timezone(
    'America/Los_Angeles',
    date_trunc('day', timezone('America/Los_Angeles', p_from))
      + interval '1 day 9 hours'
  );
$$;

create or replace function public.mc_create_round(
  p_month_key text,
  p_mode text,
  p_created_by bigint default null,
  p_open_at timestamptz default null
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.rounds;
  round_id bigint;
  open_at timestamptz := coalesce(p_open_at, public.mc_next_9am_pacific(now()));
  phase_type text;
  phase_status text;
  phase_open timestamptz;
begin
  if p_mode not in ('scrambled', 'paired') then
    raise exception 'Mode must be scrambled or paired';
  end if;

  insert into public.rounds (
    month_key, status, mode, timezone, next_open_at, created_by
  ) values (
    p_month_key, 'ACTIVE', p_mode, 'America/Los_Angeles', open_at, p_created_by
  ) returning * into result;

  round_id := result.id;
  foreach phase_type in array array[
    'CATEGORY_SUBMISSIONS', 'CATEGORY_SPIN', 'MOVIE_SUBMISSIONS', 'BRACKET'
  ] loop
    phase_status := case when phase_type = 'CATEGORY_SUBMISSIONS' then 'OPEN' else 'DRAFT' end;
    phase_open := case when phase_type = 'CATEGORY_SUBMISSIONS' then open_at else null end;
    insert into public.round_phases (
      round_id, phase_type, status, opens_at, closes_at
    ) values (
      round_id, phase_type, phase_status, phase_open,
      case when phase_open is null then null else phase_open + interval '24 hours' end
    );
  end loop;

  insert into public.round_events (round_id, event_type, actor_member_id, payload)
  values (
    round_id, 'ROUND_CREATED', p_created_by,
    jsonb_build_object('month_key', p_month_key, 'mode', p_mode, 'opens_at', open_at)
  );

  return result;
end;
$$;

create or replace function public.mc_advance_phase(
  p_phase_id bigint,
  p_actor_member_id bigint,
  p_reason text default 'admin'
)
returns public.round_phases
language plpgsql
security definer
set search_path = public
as $$
declare
  current_phase public.round_phases;
  next_phase public.round_phases;
  next_type text;
  next_open timestamptz;
begin
  select * into current_phase from public.round_phases where id = p_phase_id for update;
  if not found or current_phase.status not in ('OPEN', 'CLOSED') then
    raise exception 'Phase cannot be advanced';
  end if;

  update public.round_phases
  set status = 'CLOSED',
      closes_at = coalesce(closes_at, now()),
      closed_reason = case when p_reason = 'timer' then 'TIMER' else 'ADMIN' end,
      advanced_by = p_actor_member_id,
      advance_reason = p_reason
  where id = current_phase.id;

  next_type := public.mc_next_phase_type(current_phase.phase_type);
  if next_type is null then
    update public.rounds set status = 'COMPLETE', completed_at = now()
    where id = current_phase.round_id;
    insert into public.round_events (round_id, phase_id, event_type, actor_member_id, payload)
    values (current_phase.round_id, current_phase.id, 'ROUND_COMPLETED', p_actor_member_id,
      jsonb_build_object('reason', p_reason));
    return current_phase;
  end if;

  next_open := public.mc_next_9am_pacific(now());
  update public.round_phases
  set status = 'OPEN',
      opens_at = next_open,
      closes_at = next_open + interval '24 hours',
      closed_reason = null
  where round_id = current_phase.round_id and phase_type = next_type
  returning * into next_phase;

  insert into public.round_events (round_id, phase_id, event_type, actor_member_id, payload)
  values (current_phase.round_id, next_phase.id, 'PHASE_OPENED', p_actor_member_id,
    jsonb_build_object('phase_type', next_type, 'opens_at', next_open, 'reason', p_reason));

  return next_phase;
end;
$$;

create or replace function public.mc_reopen_phase(
  p_phase_id bigint,
  p_actor_member_id bigint,
  p_reason text default 'admin reopened'
)
returns public.round_phases
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.round_phases;
begin
  update public.round_phases
  set status = 'OPEN',
      opens_at = now(),
      closes_at = now() + interval '24 hours',
      reopened_at = now(),
      reopened_by = p_actor_member_id,
      closed_reason = null,
      advance_reason = p_reason
  where id = p_phase_id
  returning * into result;

  if not found then raise exception 'Phase not found'; end if;

  insert into public.round_events (round_id, phase_id, event_type, actor_member_id, payload)
  values (result.round_id, result.id, 'PHASE_REOPENED', p_actor_member_id,
    jsonb_build_object('reason', p_reason, 'opens_at', result.opens_at));

  return result;
end;
$$;

revoke all on function public.mc_next_phase_type(text) from public;
revoke all on function public.mc_next_9am_pacific(timestamptz) from public;
revoke all on function public.mc_create_round(text, text, bigint, timestamptz) from public;
revoke all on function public.mc_advance_phase(bigint, bigint, text) from public;
revoke all on function public.mc_reopen_phase(bigint, bigint, text) from public;

grant execute on function public.mc_next_phase_type(text) to service_role;
grant execute on function public.mc_next_9am_pacific(timestamptz) to service_role;
grant execute on function public.mc_create_round(text, text, bigint, timestamptz) to service_role;
grant execute on function public.mc_advance_phase(bigint, bigint, text) to service_role;
grant execute on function public.mc_reopen_phase(bigint, bigint, text) to service_role;

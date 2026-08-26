-- Manual admin advances start the next phase immediately.
-- Automatic timer/completion processing continues to schedule the next phase
-- for the next 9:00 AM America/Los_Angeles.

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
  select * into current_phase
  from public.round_phases
  where id = p_phase_id
  for update;

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
    update public.rounds
    set status = 'COMPLETE', completed_at = now()
    where id = current_phase.round_id;

    insert into public.round_events (round_id, phase_id, event_type, actor_member_id, payload)
    values (
      current_phase.round_id,
      current_phase.id,
      'ROUND_COMPLETED',
      p_actor_member_id,
      jsonb_build_object('reason', p_reason)
    );
    return current_phase;
  end if;

  -- Manual admin advances override the minimum-response rule and open now.
  -- Automated transitions keep the fixed next-day 9 AM Pacific schedule.
  next_open := case
    when p_reason = 'admin' then now()
    else public.mc_next_9am_pacific(now())
  end;

  update public.round_phases
  set status = 'OPEN',
      opens_at = next_open,
      closes_at = case
        when p_reason = 'admin' then public.mc_next_9am_pacific(now())
        else next_open + interval '24 hours'
      end,
      closed_reason = null
  where round_id = current_phase.round_id
    and phase_type = next_type
  returning * into next_phase;

  if not found then
    raise exception 'Next phase not found';
  end if;

  insert into public.round_events (round_id, phase_id, event_type, actor_member_id, payload)
  values (
    current_phase.round_id,
    next_phase.id,
    'PHASE_OPENED',
    p_actor_member_id,
    jsonb_build_object(
      'phase_type', next_type,
      'opens_at', next_open,
      'reason', p_reason,
      'manual_override', (p_reason = 'admin')
    )
  );

  return next_phase;
end;
$$;

revoke all on function public.mc_advance_phase(bigint, bigint, text) from public;
grant execute on function public.mc_advance_phase(bigint, bigint, text) to service_role;

-- Selecting the mode is also an explicit admin action, so movie submissions
-- should become available immediately after the category spin.
create or replace function public.mc_open_movie_stage(
  p_round_id bigint,
  p_mode text,
  p_actor_member_id bigint
)
returns public.round_phases
language plpgsql
security definer
set search_path = public
as $$
declare
  round_row public.rounds;
  spin_phase public.round_phases;
  movie_phase public.round_phases;
  open_at timestamptz := now();
begin
  if p_mode not in ('paired', 'scrambled') then
    raise exception 'Mode must be paired or scrambled';
  end if;

  select * into round_row
  from public.rounds
  where id = p_round_id and status = 'ACTIVE'
  for update;
  if not found then raise exception 'Active round not found'; end if;

  select * into spin_phase
  from public.round_phases
  where round_id = p_round_id and phase_type = 'CATEGORY_SPIN'
  for update;
  if not found or spin_phase.status not in ('OPEN', 'CLOSED') then
    raise exception 'Category spin must be open or closed before movie stage';
  end if;

  select * into movie_phase
  from public.round_phases
  where round_id = p_round_id and phase_type = 'MOVIE_SUBMISSIONS'
  for update;
  if not found then raise exception 'Movie submission phase not found'; end if;

  update public.rounds
  set mode = p_mode
  where id = p_round_id;

  update public.round_phases
  set status = 'CLOSED',
      closes_at = coalesce(closes_at, now()),
      closed_reason = 'ADMIN',
      advanced_by = p_actor_member_id,
      advance_reason = 'admin selected ' || p_mode
  where id = spin_phase.id;

  update public.round_phases
  set status = 'OPEN',
      opens_at = open_at,
      closes_at = public.mc_next_9am_pacific(now()),
      closed_reason = null
  where id = movie_phase.id
  returning * into movie_phase;

  insert into public.round_events (
    round_id, phase_id, actor_member_id, event_type, payload
  ) values (
    p_round_id, movie_phase.id, p_actor_member_id, 'MOVIE_STAGE_OPENED',
    jsonb_build_object('mode', p_mode, 'opens_at', open_at, 'manual_override', true)
  );

  return movie_phase;
end;
$$;

revoke all on function public.mc_open_movie_stage(bigint, text, bigint) from public;
grant execute on function public.mc_open_movie_stage(bigint, text, bigint) to service_role;

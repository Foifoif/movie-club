-- Mode is selected after the category wheel, immediately before movie
-- submissions open. This migration is additive and contains no data deletes.

alter table public.rounds
  alter column mode drop not null;

alter table public.rounds
  alter column mode drop default;

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
  open_at timestamptz := public.mc_next_9am_pacific(now());
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
      closes_at = open_at + interval '24 hours',
      closed_reason = null
  where id = movie_phase.id
  returning * into movie_phase;

  insert into public.round_events (
    round_id, phase_id, actor_member_id, event_type, payload
  ) values (
    p_round_id, movie_phase.id, p_actor_member_id, 'MOVIE_STAGE_OPENED',
    jsonb_build_object('mode', p_mode, 'opens_at', open_at)
  );

  return movie_phase;
end;
$$;

revoke all on function public.mc_open_movie_stage(bigint, text, bigint) from public;
grant execute on function public.mc_open_movie_stage(bigint, text, bigint) to service_role;

-- Recovery action for a movie-submission phase that has already closed while
-- the bracket was not built or was left scheduled for a later opening.

create or replace function public.mc_start_bracket_now(
  p_round_id bigint,
  p_actor_member_id bigint
)
returns public.round_phases
language plpgsql
security definer
set search_path = public
as $$
declare
  round_row public.rounds;
  movie_phase public.round_phases;
  bracket_phase public.round_phases;
  updated_phase public.round_phases;
begin
  select * into round_row
  from public.rounds
  where id = p_round_id and status = 'ACTIVE'
  for update;
  if not found then raise exception 'Active round not found'; end if;

  select * into movie_phase
  from public.round_phases
  where round_id = p_round_id and phase_type = 'MOVIE_SUBMISSIONS';
  select * into bracket_phase
  from public.round_phases
  where round_id = p_round_id and phase_type = 'BRACKET'
  for update;

  if movie_phase.status <> 'CLOSED' then
    raise exception 'Movie submissions must be closed before starting the bracket';
  end if;
  if bracket_phase.status = 'CLOSED' then
    raise exception 'The bracket is already closed';
  end if;

  if exists (select 1 from public.bracket_entries where round_id = p_round_id)
     or exists (select 1 from public.bracket_matchups where round_id = p_round_id) then
    update public.round_phases
    set status = 'OPEN', opens_at = now(), closes_at = now() + interval '24 hours'
    where id = bracket_phase.id
    returning * into updated_phase;

    update public.bracket_matchups
    set opens_at = now(), closes_at = now() + interval '24 hours'
    where round_id = p_round_id
      and bracket_round_number = 1
      and status = 'OPEN';

    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    values (
      p_round_id, bracket_phase.id, p_actor_member_id, 'BRACKET_OPENED_IMMEDIATELY',
      jsonb_build_object('opens_at', now(), 'recovered_existing_bracket', true)
    );
    return updated_phase;
  end if;

  perform public.mc_build_bracket_immediate(p_round_id, p_actor_member_id);
  select * into updated_phase from public.round_phases where id = bracket_phase.id;
  return updated_phase;
end;
$$;

revoke all on function public.mc_start_bracket_now(bigint, bigint) from public;
grant execute on function public.mc_start_bracket_now(bigint, bigint) to service_role;

-- The first bracket starts as soon as movie submissions close. Later bracket
-- rounds retain their existing per-round scheduling behavior.

-- Keep the original builder available for the wrapper below, while making
-- existing automation calls to mc_build_bracket use the corrected behavior.
alter function public.mc_build_bracket(bigint, bigint)
  rename to mc_build_bracket_scheduled;

create or replace function public.mc_build_bracket(
  p_round_id bigint,
  p_actor_member_id bigint
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  matchup_count integer;
  bracket_phase_id bigint;
begin
  matchup_count := public.mc_build_bracket_scheduled(p_round_id, p_actor_member_id);

  select id into bracket_phase_id
  from public.round_phases
  where round_id = p_round_id and phase_type = 'BRACKET';

  update public.round_phases
  set opens_at = now(), closes_at = now() + interval '24 hours'
  where id = bracket_phase_id;

  update public.bracket_matchups
  set opens_at = now(), closes_at = now() + interval '24 hours'
  where round_id = p_round_id
    and bracket_round_number = 1
    and status = 'OPEN';

  insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
  values (
    p_round_id,
    bracket_phase_id,
    p_actor_member_id,
    'BRACKET_OPENED_IMMEDIATELY',
    jsonb_build_object('opens_at', now(), 'matchup_count', matchup_count)
  );

  return matchup_count;
end;
$$;

create or replace function public.mc_build_bracket_immediate(
  p_round_id bigint,
  p_actor_member_id bigint
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  matchup_count integer;
  bracket_phase_id bigint;
begin
  return public.mc_build_bracket(p_round_id, p_actor_member_id);
end;
$$;

revoke all on function public.mc_build_bracket_scheduled(bigint, bigint) from public;
grant execute on function public.mc_build_bracket_scheduled(bigint, bigint) to service_role;
revoke all on function public.mc_build_bracket(bigint, bigint) from public;
grant execute on function public.mc_build_bracket(bigint, bigint) to service_role;
revoke all on function public.mc_build_bracket_immediate(bigint, bigint) from public;
grant execute on function public.mc_build_bracket_immediate(bigint, bigint) to service_role;

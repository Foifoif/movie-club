-- Manual bracket advances resolve the current open matchups and open the next
-- bracket round immediately. Automatic timer processing keeps its 9 AM rule.

create or replace function public.mc_resolve_matchup_immediate(
  p_matchup_id bigint,
  p_actor_member_id bigint
)
returns public.bracket_matchups
language plpgsql
security definer
set search_path = public
as $$
declare
  result_matchup public.bracket_matchups;
  bracket_phase_id bigint;
  next_bracket_round integer;
begin
  result_matchup := public.mc_resolve_matchup(p_matchup_id, p_actor_member_id, 'admin');

  select id into bracket_phase_id
  from public.round_phases
  where round_id = result_matchup.round_id and phase_type = 'BRACKET';

  select max(bracket_round_number) into next_bracket_round
  from public.bracket_matchups
  where round_id = result_matchup.round_id;

  update public.round_phases
  set opens_at = now(), closes_at = now() + interval '24 hours'
  where id = bracket_phase_id
    and status = 'OPEN'
    and exists (
      select 1 from public.bracket_matchups
      where round_id = result_matchup.round_id
        and bracket_round_number = next_bracket_round
        and status = 'OPEN'
    );

  update public.bracket_matchups
  set opens_at = now(), closes_at = now() + interval '24 hours'
  where round_id = result_matchup.round_id
    and bracket_round_number = next_bracket_round
    and status = 'OPEN';

  return result_matchup;
end;
$$;

revoke all on function public.mc_resolve_matchup_immediate(bigint, bigint) from public;
grant execute on function public.mc_resolve_matchup_immediate(bigint, bigint) to service_role;

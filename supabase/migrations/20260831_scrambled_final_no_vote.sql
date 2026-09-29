-- In scrambled mode, the final two movies are co-winners. Do not turn their
-- final matchup into a vote; finalize it when the admin advances the bracket.

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
  matchup public.bracket_matchups;
  round_row public.rounds;
  bracket_phase_id bigint;
  next_bracket_round integer;
begin
  select * into matchup from public.bracket_matchups where id = p_matchup_id for update;
  if not found or matchup.status <> 'OPEN' then raise exception 'This matchup is not open'; end if;
  select * into round_row from public.rounds where id = matchup.round_id for update;
  select id into bracket_phase_id from public.round_phases
    where round_id = matchup.round_id and phase_type = 'BRACKET';

  if round_row.mode = 'scrambled'
     and matchup.entry_a_id is not null and matchup.entry_b_id is not null
     and not exists (
       select 1 from public.bracket_matchups other
       where other.round_id = matchup.round_id
         and other.bracket_round_number = matchup.bracket_round_number
         and other.id <> matchup.id and other.status = 'OPEN'
     )
     and not exists (
       select 1 from public.bracket_matchups later
       where later.round_id = matchup.round_id
         and later.bracket_round_number > matchup.bracket_round_number
         and later.status <> 'CANCELLED'
     ) then
    update public.bracket_matchups
    set status = 'CLOSED', winner_entry_id = null,
        result_entry_ids = array[entry_a_id, entry_b_id],
        tie_resolved = false, tie_resolution_note = 'Final two retained; no vote required'
    where id = matchup.id returning * into matchup;

    update public.round_phases
    set status = 'CLOSED', closes_at = now(), closed_reason = 'EVERYONE_COMPLETE'
    where id = bracket_phase_id;
    update public.rounds set status = 'COMPLETE', completed_at = now() where id = matchup.round_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    values (matchup.round_id, bracket_phase_id, p_actor_member_id, 'ROUND_COMPLETED',
      jsonb_build_object('mode', 'scrambled', 'final_entry_ids', matchup.result_entry_ids,
                         'reason', 'final_two_no_vote'));
    return matchup;
  end if;

  return public.mc_resolve_matchup(p_matchup_id, p_actor_member_id, 'admin');
end;
$$;

revoke all on function public.mc_resolve_matchup_immediate(bigint, bigint) from public;
grant execute on function public.mc_resolve_matchup_immediate(bigint, bigint) to service_role;

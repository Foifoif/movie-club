-- Admin-only, narrowly scoped undo controls. These never reset an entire round.

create or replace function public.mc_undo_last_round_result(
  p_round_id bigint,
  p_actor_member_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  round_row public.rounds;
  spin_phase public.round_phases;
  movie_phase public.round_phases;
  bracket_phase public.round_phases;
  last_matchup public.bracket_matchups;
begin
  select * into round_row from public.rounds where id = p_round_id for update;
  if not found or round_row.status not in ('ACTIVE', 'COMPLETE') then
    raise exception 'Round is not available for an undo';
  end if;

  select * into spin_phase from public.round_phases
  where round_id = p_round_id and phase_type = 'CATEGORY_SPIN';
  select * into movie_phase from public.round_phases
  where round_id = p_round_id and phase_type = 'MOVIE_SUBMISSIONS';

  -- Wheel undo is allowed only before the admin has selected a movie mode.
  if round_row.mode is null and spin_phase.status = 'CLOSED' and movie_phase.status = 'DRAFT'
     and not exists (select 1 from public.movie_submissions ms where ms.phase_id = movie_phase.id)
     and not exists (select 1 from public.bracket_entries be where be.round_id = p_round_id) then
    delete from public.category_spins where phase_id = spin_phase.id;
    update public.round_phases
    set status = 'OPEN', opens_at = now(), closes_at = now() + interval '24 hours',
        closed_reason = null, advanced_by = null, advance_reason = null,
        reopened_at = now(), reopened_by = p_actor_member_id
    where id = spin_phase.id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    values (p_round_id, spin_phase.id, p_actor_member_id, 'CATEGORY_SPIN_UNDONE',
            jsonb_build_object('reason', 'admin revised wheel result'));
    return jsonb_build_object('type', 'CATEGORY_SPIN', 'status', 'OPEN');
  end if;

  select * into last_matchup from public.bracket_matchups
  where round_id = p_round_id and status = 'CLOSED'
    and (winner_entry_id is not null or coalesce(cardinality(result_entry_ids), 0) > 0)
  order by bracket_round_number desc, id desc limit 1;
  if not found then
    raise exception 'No undoable round result was found';
  end if;

  if exists (select 1 from public.bracket_matchups
             where round_id = p_round_id and status = 'OPEN')
     or exists (select 1 from public.bracket_matchups
                where round_id = p_round_id
                  and bracket_round_number > last_matchup.bracket_round_number) then
    raise exception 'Undo is only available for the latest completed matchup before a later bracket round opens';
  end if;

  delete from public.bracket_votes where matchup_id = last_matchup.id;
  update public.bracket_matchups
  set status = 'OPEN', opens_at = now(), closes_at = now() + interval '24 hours',
      winner_entry_id = null, result_entry_ids = '{}', tie_resolved = false,
      tie_resolution_note = null
  where id = last_matchup.id;

  select * into bracket_phase from public.round_phases
  where round_id = p_round_id and phase_type = 'BRACKET';
  update public.round_phases
  set status = 'OPEN', opens_at = now(), closes_at = now() + interval '24 hours',
      closed_reason = null
  where id = bracket_phase.id;
  update public.rounds set status = 'ACTIVE', completed_at = null where id = p_round_id;

  insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
  values (p_round_id, bracket_phase.id, p_actor_member_id, 'BRACKET_RESULT_UNDONE',
          jsonb_build_object('matchup_id', last_matchup.id,
                             'bracket_round_number', last_matchup.bracket_round_number));
  return jsonb_build_object('type', 'BRACKET', 'matchup_id', last_matchup.id, 'status', 'OPEN');
end;
$$;

revoke all on function public.mc_undo_last_round_result(bigint, bigint) from public;
grant execute on function public.mc_undo_last_round_result(bigint, bigint) to service_role;

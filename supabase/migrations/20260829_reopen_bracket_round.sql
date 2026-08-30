-- Reopen one existing bracket round without rebuilding the bracket.
-- Votes in the selected round are cleared for a fresh vote; downstream
-- matchups are cancelled because their winners are no longer authoritative.

create or replace function public.mc_reopen_bracket_round(
  p_round_id bigint,
  p_bracket_round_number integer,
  p_actor_member_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  round_row public.rounds;
  bracket_phase public.round_phases;
  selected_count integer;
  reopened_count integer;
  cancelled_count integer;
begin
  select * into round_row
  from public.rounds
  where id = p_round_id and status in ('ACTIVE', 'COMPLETE')
  for update;
  if not found then raise exception 'Round is not available'; end if;
  if p_bracket_round_number < 1 then raise exception 'Bracket round must be at least 1'; end if;

  select * into bracket_phase
  from public.round_phases
  where round_id = p_round_id and phase_type = 'BRACKET'
  for update;
  if not found then raise exception 'Bracket phase not found'; end if;

  select count(*) into selected_count
  from public.bracket_matchups
  where round_id = p_round_id
    and bracket_round_number = p_bracket_round_number
    and status <> 'CANCELLED';
  if selected_count = 0 then raise exception 'Bracket round not found'; end if;

  delete from public.bracket_votes
  where matchup_id in (
    select id from public.bracket_matchups
    where round_id = p_round_id and bracket_round_number = p_bracket_round_number
  );

  update public.bracket_matchups
  set status = case when entry_a_id is not null and entry_b_id is not null then 'OPEN' else 'CLOSED' end,
      opens_at = case when entry_a_id is not null and entry_b_id is not null then now() else opens_at end,
      closes_at = case when entry_a_id is not null and entry_b_id is not null then now() + interval '24 hours' else closes_at end,
      winner_entry_id = case when entry_a_id is not null and entry_b_id is not null then null else winner_entry_id end,
      result_entry_ids = case when entry_a_id is not null and entry_b_id is not null then '{}' else result_entry_ids end,
      tie_resolved = case when entry_a_id is not null and entry_b_id is not null then false else tie_resolved end,
      tie_resolution_note = case when entry_a_id is not null and entry_b_id is not null then null else tie_resolution_note end
  where round_id = p_round_id and bracket_round_number = p_bracket_round_number;
  get diagnostics reopened_count = row_count;

  delete from public.bracket_votes
  where matchup_id in (
    select id from public.bracket_matchups
    where round_id = p_round_id and bracket_round_number > p_bracket_round_number
  );
  update public.bracket_matchups
  set status = 'CANCELLED', opens_at = null, closes_at = null,
      winner_entry_id = null, result_entry_ids = '{}', tie_resolved = false,
      tie_resolution_note = null
  where round_id = p_round_id and bracket_round_number > p_bracket_round_number
    and status <> 'CANCELLED';
  get diagnostics cancelled_count = row_count;

  update public.round_phases
  set status = 'OPEN', opens_at = now(), closes_at = now() + interval '24 hours',
      closed_reason = null, reopened_at = now(), reopened_by = p_actor_member_id
  where id = bracket_phase.id;
  update public.rounds set status = 'ACTIVE', completed_at = null where id = p_round_id;

  insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
  values (p_round_id, bracket_phase.id, p_actor_member_id, 'BRACKET_ROUND_REOPENED',
    jsonb_build_object('bracket_round_number', p_bracket_round_number,
      'reopened_matchups', reopened_count, 'cancelled_downstream_matchups', cancelled_count,
      'new_closes_at', now() + interval '24 hours'));

  return jsonb_build_object('round_id', p_round_id, 'bracket_round_number', p_bracket_round_number,
    'status', 'OPEN', 'reopened_matchups', reopened_count,
    'cancelled_downstream_matchups', cancelled_count);
end;
$$;

revoke all on function public.mc_reopen_bracket_round(bigint, integer, bigint) from public;
grant execute on function public.mc_reopen_bracket_round(bigint, integer, bigint) to service_role;

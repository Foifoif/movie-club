-- Reopening an earlier phase also resets its not-yet-valid downstream phase.
-- Existing submissions and event history are preserved. A built bracket is
-- intentionally protected; use the existing undo controls before reopening
-- movie submissions in that situation.

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
  downstream public.round_phases;
  spin_count integer;
  bracket_entry_count integer;
  bracket_matchup_count integer;
begin
  select * into result
  from public.round_phases
  where id = p_phase_id
  for update;

  if not found then
    raise exception 'Phase not found';
  end if;

  if result.phase_type = 'CATEGORY_SUBMISSIONS' then
    select * into downstream
    from public.round_phases
    where round_id = result.round_id and phase_type = 'CATEGORY_SPIN'
    for update;

    if found then
      select count(*)::integer into spin_count
      from public.category_spins
      where phase_id = downstream.id;

      if spin_count > 0 then
        raise exception 'Category Spin already has results; undo the wheel result before reopening Category Submissions';
      end if;

      update public.round_phases
      set status = 'DRAFT',
          opens_at = null,
          closes_at = null,
          closed_reason = null,
          advanced_by = null,
          advance_reason = null
      where id = downstream.id;
    end if;
  elsif result.phase_type = 'MOVIE_SUBMISSIONS' then
    select * into downstream
    from public.round_phases
    where round_id = result.round_id and phase_type = 'BRACKET'
    for update;

    if found then
      select count(*)::integer into bracket_entry_count
      from public.bracket_entries
      where round_id = result.round_id;

      select count(*)::integer into bracket_matchup_count
      from public.bracket_matchups
      where round_id = result.round_id;

      if bracket_entry_count > 0 or bracket_matchup_count > 0 then
        raise exception 'Bracket already exists; undo the latest bracket result before reopening Movie Submissions';
      end if;

      update public.round_phases
      set status = 'DRAFT',
          opens_at = null,
          closes_at = null,
          closed_reason = null,
          advanced_by = null,
          advance_reason = null
      where id = downstream.id;
    end if;
  end if;

  update public.round_phases
  set status = 'OPEN',
      opens_at = now(),
      closes_at = now() + interval '24 hours',
      reopened_at = now(),
      reopened_by = p_actor_member_id,
      closed_reason = null,
      advanced_by = null,
      advance_reason = p_reason
  where id = result.id
  returning * into result;

  insert into public.round_events (
    round_id, phase_id, actor_member_id, event_type, payload
  ) values (
    result.round_id,
    result.id,
    p_actor_member_id,
    'PHASE_REOPENED',
    jsonb_build_object(
      'phase_type', result.phase_type,
      'reason', p_reason,
      'opens_at', result.opens_at,
      'downstream_reset', result.phase_type in ('CATEGORY_SUBMISSIONS', 'MOVIE_SUBMISSIONS')
    )
  );

  return result;
end;
$$;

revoke all on function public.mc_reopen_phase(bigint, bigint, text) from public;
grant execute on function public.mc_reopen_phase(bigint, bigint, text) to service_role;

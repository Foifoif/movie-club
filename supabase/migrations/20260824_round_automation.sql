-- Timer/automatic-completion processor. It is service-role-only and does not
-- delete or overwrite submissions, votes, or history.

create or replace function public.mc_process_due_rounds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  phase_row public.round_phases;
  matchup_row public.bracket_matchups;
  member_count integer;
  action_count integer;
  processed integer := 0;
  has_two_movies boolean;
begin
  select count(*)::integer into member_count from public.members;

  for phase_row in
    select rp.*
    from public.round_phases rp
    join public.rounds r on r.id = rp.round_id
    where r.status = 'ACTIVE'
      and rp.status = 'OPEN'
      and (
        rp.closes_at <= now()
        or (rp.phase_type = 'CATEGORY_SUBMISSIONS' and
            (select count(*) from public.category_submissions cs where cs.phase_id = rp.id) >= member_count)
        or (rp.phase_type = 'CATEGORY_SPIN' and
            (select count(*) from public.category_spins cs where cs.phase_id = rp.id) >= member_count)
        or (rp.phase_type = 'MOVIE_SUBMISSIONS' and
            (select count(*) from public.movie_submissions ms where ms.phase_id = rp.id) >= member_count * 2)
      )
    order by rp.id
    for update
  loop
    if phase_row.phase_type = 'CATEGORY_SUBMISSIONS' then
      select count(*)::integer into action_count
      from public.category_submissions where phase_id = phase_row.id;
    elsif phase_row.phase_type = 'CATEGORY_SPIN' then
      select count(*)::integer into action_count
      from public.category_spins where phase_id = phase_row.id;
    else
      select count(*)::integer into action_count
      from (
        select member_id
        from public.movie_submissions
        where phase_id = phase_row.id
        group by member_id
        having count(distinct slot) = 2
      ) complete_members;
    end if;

    if phase_row.closes_at <= now() and action_count < 3 then
      update public.round_phases
      set closes_at = coalesce(closes_at, now()) + interval '24 hours',
          closed_reason = 'MINIMUM_NOT_MET'
      where id = phase_row.id;

      insert into public.round_events (round_id, phase_id, event_type, payload)
      values (
        phase_row.round_id, phase_row.id, 'PHASE_MINIMUM_NOT_MET',
        jsonb_build_object('actions', action_count, 'required', 3,
                           'new_closes_at', phase_row.closes_at + interval '24 hours')
      );
      processed := processed + 1;
      continue;
    end if;

    if phase_row.phase_type = 'CATEGORY_SPIN' then
      -- Mode is intentionally chosen by the admin after the wheel.
      update public.round_phases
      set status = 'CLOSED', closes_at = now(), closed_reason =
        case when action_count >= member_count then 'EVERYONE_COMPLETE' else 'TIMER' end
      where id = phase_row.id;

      insert into public.round_events (round_id, phase_id, event_type, payload)
      values (
        phase_row.round_id, phase_row.id, 'CATEGORY_SPIN_READY_FOR_MODE',
        jsonb_build_object('actions', action_count, 'reason',
          case when action_count >= member_count then 'everyone_complete' else 'timer' end)
      );
    else
      perform public.mc_advance_phase(
        phase_row.id, null,
        case when action_count >= member_count then 'everyone_complete' else 'timer' end
      );

      if phase_row.phase_type = 'MOVIE_SUBMISSIONS' then
        perform public.mc_build_bracket_immediate(phase_row.round_id, null);
      end if;
    end if;
    processed := processed + 1;
  end loop;

  for matchup_row in
    select bm.*
    from public.bracket_matchups bm
    join public.rounds r on r.id = bm.round_id
    where r.status = 'ACTIVE'
      and bm.status = 'OPEN'
      and (
        bm.closes_at <= now()
        or (select count(*) from public.bracket_votes bv where bv.matchup_id = bm.id) >= member_count
      )
    order by bm.id
  loop
    perform public.mc_resolve_matchup(
      matchup_row.id, null,
      case when matchup_row.closes_at <= now() then 'timer' else 'everyone_complete' end
    );
    processed := processed + 1;
  end loop;

  return processed;
end;
$$;

revoke all on function public.mc_process_due_rounds() from public;
grant execute on function public.mc_process_due_rounds() to service_role;

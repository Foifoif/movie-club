-- Continue scrambled brackets until exactly two final movies remain.
-- The prior resolver could mistake the end of round one for the final.

create or replace function public.mc_resolve_matchup(
  p_matchup_id bigint,
  p_actor_member_id bigint,
  p_reason text default 'timer'
)
returns public.bracket_matchups
language plpgsql
security definer
set search_path = public
as $$
declare
  matchup public.bracket_matchups;
  phase_id bigint;
  round_row public.rounds;
  vote_count integer;
  winner_id bigint;
  tie boolean := false;
  current_round integer;
  next_round integer;
  next_open timestamptz := public.mc_next_9am_pacific(now());
  survivor_count integer;
  pending_id bigint := null;
  entry_id bigint;
  next_matchups integer := 0;
  final_ids bigint[];
begin
  select * into matchup from public.bracket_matchups where id = p_matchup_id for update;
  if not found or matchup.status <> 'OPEN' then
    raise exception 'This matchup is not open';
  end if;

  if p_reason = 'timer' and matchup.closes_at is not null and matchup.closes_at > now() then
    raise exception 'This matchup timer has not expired';
  end if;

  select r.* into round_row from public.rounds r where r.id = matchup.round_id for update;
  select count(*)::integer into vote_count from public.bracket_votes where matchup_id = matchup.id;

  if p_reason = 'timer' and vote_count < 3 then
    update public.bracket_matchups
    set closes_at = coalesce(closes_at, now()) + interval '24 hours'
    where id = matchup.id returning * into matchup;

    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    select matchup.round_id, rp.id, p_actor_member_id, 'MATCHUP_MINIMUM_NOT_MET',
      jsonb_build_object('matchup_id', matchup.id, 'votes', vote_count, 'required', 3,
                         'new_closes_at', matchup.closes_at)
    from public.round_phases rp
    where rp.round_id = matchup.round_id and rp.phase_type = 'BRACKET';
    return matchup;
  end if;

  select v.entry_id into winner_id
  from public.bracket_votes v
  where v.matchup_id = matchup.id
  group by v.entry_id
  order by count(*) desc, random()
  limit 1;

  if winner_id is null then
    select x.entry_id into winner_id
    from (values (matchup.entry_a_id), (matchup.entry_b_id)) x(entry_id)
    where x.entry_id is not null order by random() limit 1;
  end if;

  select count(*) > 1 into tie
  from (select count(*) as votes from public.bracket_votes where matchup_id = matchup.id group by entry_id) tied
  where tied.votes = (
    select coalesce(max(votes), 0)
    from (select count(*) as votes from public.bracket_votes where matchup_id = matchup.id group by entry_id) max_votes
  );

  select id into phase_id from public.round_phases
  where round_id = matchup.round_id and phase_type = 'BRACKET';

  update public.bracket_matchups
  set status = 'CLOSED', winner_entry_id = winner_id,
      result_entry_ids = array[winner_id],
      tie_resolved = tie,
      tie_resolution_note = case when tie then 'Randomly selected winner' else null end
  where id = matchup.id returning * into matchup;

  insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
  values (matchup.round_id, phase_id, p_actor_member_id,
    case when tie then 'MATCHUP_TIE_RESOLVED' else 'MATCHUP_RESOLVED' end,
    jsonb_build_object('matchup_id', matchup.id, 'winner_entry_id', matchup.winner_entry_id,
                       'result_entry_ids', matchup.result_entry_ids, 'votes', vote_count,
                       'reason', p_reason));

  if exists (
    select 1 from public.bracket_matchups bm
    where bm.round_id = matchup.round_id
      and bm.bracket_round_number = matchup.bracket_round_number
      and bm.status = 'OPEN'
  ) then
    return matchup;
  end if;

  select max(bracket_round_number) into current_round
  from public.bracket_matchups where round_id = matchup.round_id;

  select count(*) into survivor_count
  from public.bracket_matchups bm
  where bm.round_id = matchup.round_id
    and bm.bracket_round_number = current_round
    and bm.winner_entry_id is not null;

  if round_row.mode = 'paired' and survivor_count = 1 then
    update public.round_phases set status = 'CLOSED', closes_at = now(), closed_reason = 'EVERYONE_COMPLETE'
    where id = phase_id;
    update public.rounds set status = 'COMPLETE', completed_at = now() where id = matchup.round_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    values (matchup.round_id, phase_id, p_actor_member_id, 'ROUND_COMPLETED',
            jsonb_build_object('mode', 'paired', 'winner_entry_id', matchup.winner_entry_id));
    return matchup;
  end if;

  if round_row.mode = 'scrambled'
     and (select count(*) from public.bracket_matchups bm
          where bm.round_id = matchup.round_id
            and bm.bracket_round_number = current_round) = 1
     and matchup.entry_a_id is not null
     and matchup.entry_b_id is not null then
    final_ids := array[matchup.entry_a_id, matchup.entry_b_id];
    update public.round_phases set status = 'CLOSED', closes_at = now(), closed_reason = 'EVERYONE_COMPLETE'
    where id = phase_id;
    update public.rounds set status = 'COMPLETE', completed_at = now() where id = matchup.round_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    values (matchup.round_id, phase_id, p_actor_member_id, 'ROUND_COMPLETED',
            jsonb_build_object('mode', 'scrambled', 'final_entry_ids', final_ids));
    return matchup;
  end if;

  next_round := current_round + 1;
  for entry_id in
    select bm.winner_entry_id
    from public.bracket_matchups bm
    where bm.round_id = matchup.round_id
      and bm.bracket_round_number = current_round
      and bm.winner_entry_id is not null
    order by random()
  loop
    if pending_id is null then pending_id := entry_id;
    else
      insert into public.bracket_matchups (
        round_id, bracket_round_number, entry_a_id, entry_b_id, status, opens_at, closes_at
      ) values (
        matchup.round_id, next_round, pending_id, entry_id, 'OPEN', next_open, next_open + interval '24 hours'
      );
      next_matchups := next_matchups + 1;
      pending_id := null;
    end if;
  end loop;

  if pending_id is not null then
    update public.bracket_entries set bye_awarded = true where id = pending_id;
    insert into public.bracket_matchups (
      round_id, bracket_round_number, entry_a_id, status, opens_at, closes_at, winner_entry_id, result_entry_ids
    ) values (
      matchup.round_id, next_round, pending_id, 'CLOSED', next_open, next_open, pending_id, array[pending_id]
    );
  end if;

  if next_matchups = 0 and pending_id is null then
    update public.round_phases set status = 'CLOSED', closes_at = now(), closed_reason = 'EVERYONE_COMPLETE'
    where id = phase_id;
    update public.rounds set status = 'COMPLETE', completed_at = now() where id = matchup.round_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    values (matchup.round_id, phase_id, p_actor_member_id, 'ROUND_COMPLETED',
            jsonb_build_object('mode', round_row.mode, 'reason', 'final_winner'));
  else
    update public.round_phases set opens_at = next_open, closes_at = next_open + interval '24 hours'
    where id = phase_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    values (matchup.round_id, phase_id, p_actor_member_id, 'BRACKET_ROUND_OPENED',
            jsonb_build_object('bracket_round_number', next_round, 'matchup_count', next_matchups,
                               'opens_at', next_open));
  end if;

  return matchup;
end;
$$;

revoke all on function public.mc_resolve_matchup(bigint, bigint, text) from public;
grant execute on function public.mc_resolve_matchup(bigint, bigint, text) to service_role;

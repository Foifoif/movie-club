-- Construct the first bracket from the completed movie-submission phase.
-- Matchup resolution/advancement is kept separate so each bracket round can
-- be tested and audited independently.

alter table public.bracket_matchups
  add column if not exists result_entry_ids bigint[] not null default '{}';

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
  round_row public.rounds;
  movie_phase_id bigint;
  bracket_phase_id bigint;
  entry_count integer;
  bye_entry_id bigint;
  pending_entry_id bigint := null;
  entry_id bigint;
  matchup_count integer := 0;
  bracket_open timestamptz := public.mc_next_9am_pacific(now());
begin
  select * into round_row from public.rounds where id = p_round_id for update;
  if not found then raise exception 'Round not found'; end if;

  select id into movie_phase_id from public.round_phases
  where round_id = p_round_id and phase_type = 'MOVIE_SUBMISSIONS';
  select id into bracket_phase_id from public.round_phases
  where round_id = p_round_id and phase_type = 'BRACKET';

  if movie_phase_id is null or bracket_phase_id is null then
    raise exception 'Round phases are incomplete';
  end if;

  if exists (
    select 1 from public.bracket_entries where round_id = p_round_id
  ) or exists (
    select 1 from public.bracket_matchups where round_id = p_round_id
  ) then
    raise exception 'Bracket already exists for this round; create a new round or use an admin reset operation';
  end if;

  if round_row.mode = 'scrambled' then
    with submitted_movies as (
      select ms.tmdb_id, ms.title, ms.year, ms.poster,
             coalesce(ms.tmdb_id::text, lower(trim(ms.title))) as movie_key
      from public.movie_submissions ms
      where ms.phase_id = movie_phase_id
    ), unique_movies as (
      select distinct on (movie_key)
        tmdb_id, title, year, poster, movie_key
      from submitted_movies
      order by movie_key, title
    )
    insert into public.bracket_entries (
      round_id, entry_type, movie_a_tmdb_id, movie_a_title, movie_a_poster, seed
    )
    select p_round_id, 'MOVIE', tmdb_id, title, poster,
           floor(random() * 1000000000)::integer
    from unique_movies;
  else
    with member_pairs as (
      select
        ms.member_id,
        max(ms.tmdb_id) filter (where ms.slot = 1) as a_tmdb_id,
        max(ms.tmdb_id) filter (where ms.slot = 2) as b_tmdb_id,
        max(ms.title) filter (where ms.slot = 1) as a_title,
        max(ms.title) filter (where ms.slot = 2) as b_title,
        max(ms.year) filter (where ms.slot = 1) as a_year,
        max(ms.year) filter (where ms.slot = 2) as b_year,
        max(ms.poster) filter (where ms.slot = 1) as a_poster,
        max(ms.poster) filter (where ms.slot = 2) as b_poster,
        max(coalesce(ms.tmdb_id::text, lower(trim(ms.title))))
          filter (where ms.slot = 1) as a_key,
        max(coalesce(ms.tmdb_id::text, lower(trim(ms.title))))
          filter (where ms.slot = 2) as b_key
      from public.movie_submissions ms
      where ms.phase_id = movie_phase_id
      group by ms.member_id
      having count(distinct ms.slot) = 2
    ), deduped_pairs as (
      select distinct on (least(a_key, b_key) || '|' || greatest(a_key, b_key)) *
      from member_pairs
      order by least(a_key, b_key) || '|' || greatest(a_key, b_key), member_id
    )
    insert into public.bracket_entries (
      round_id, entry_type, source_member_id,
      movie_a_tmdb_id, movie_b_tmdb_id,
      movie_a_title, movie_b_title, movie_a_poster, movie_b_poster, seed
    )
    select p_round_id, 'PAIR', member_id,
           a_tmdb_id, b_tmdb_id, a_title, b_title,
           a_poster, b_poster,
           floor(random() * 1000000000)::integer
    from deduped_pairs;

    update public.bracket_entries e
    set duplicate_score = (
      select count(*)::integer
      from public.bracket_entries other
      where other.round_id = p_round_id
        and other.id <> e.id
        and (
          coalesce(e.movie_a_tmdb_id::text, lower(trim(e.movie_a_title))) = coalesce(other.movie_a_tmdb_id::text, lower(trim(other.movie_a_title)))
          or coalesce(e.movie_a_tmdb_id::text, lower(trim(e.movie_a_title))) = coalesce(other.movie_b_tmdb_id::text, lower(trim(other.movie_b_title)))
          or coalesce(e.movie_b_tmdb_id::text, lower(trim(e.movie_b_title))) = coalesce(other.movie_a_tmdb_id::text, lower(trim(other.movie_a_title)))
          or coalesce(e.movie_b_tmdb_id::text, lower(trim(e.movie_b_title))) = coalesce(other.movie_b_tmdb_id::text, lower(trim(other.movie_b_title)))
        )
    )
    where e.round_id = p_round_id;
  end if;

  select count(*) into entry_count
  from public.bracket_entries where round_id = p_round_id;
  if entry_count < 2 then raise exception 'At least two valid bracket entries are required'; end if;

  if entry_count % 2 = 1 then
    select id into bye_entry_id
    from public.bracket_entries
    where round_id = p_round_id
    order by duplicate_score desc, random()
    limit 1;

    update public.bracket_entries set bye_awarded = true where id = bye_entry_id;
    insert into public.bracket_matchups (
      round_id, bracket_round_number, entry_a_id, status,
      opens_at, closes_at, winner_entry_id
    ) values (
      p_round_id, 1, bye_entry_id, 'CLOSED',
      bracket_open, bracket_open, bye_entry_id
    );

    matchup_count := matchup_count + 1;
  end if;

  for entry_id in
    select id from public.bracket_entries
    where round_id = p_round_id and id <> coalesce(bye_entry_id, -1)
    order by random()
  loop
    if pending_entry_id is null then
      pending_entry_id := entry_id;
    else
      insert into public.bracket_matchups (
        round_id, bracket_round_number, entry_a_id, entry_b_id,
        status, opens_at, closes_at
      ) values (
        p_round_id, 1, pending_entry_id, entry_id,
        'OPEN', bracket_open, bracket_open + interval '24 hours'
      );
      matchup_count := matchup_count + 1;
      pending_entry_id := null;
    end if;
  end loop;

  update public.round_phases
  set status = 'OPEN', opens_at = bracket_open,
      closes_at = bracket_open + interval '24 hours'
  where id = bracket_phase_id;

  insert into public.round_events (
    round_id, phase_id, actor_member_id, event_type, payload
  ) values (
    p_round_id, bracket_phase_id, p_actor_member_id, 'BRACKET_BUILT',
    jsonb_build_object(
      'mode', round_row.mode,
      'entry_count', entry_count,
      'matchup_count', matchup_count,
      'opens_at', bracket_open
    )
  );

  return matchup_count;
end;
$$;

revoke all on function public.mc_build_bracket(bigint, bigint) from public;
grant execute on function public.mc_build_bracket(bigint, bigint) to service_role;

-- Resolve one matchup and, when the bracket round is complete, construct the
-- next round. This is deliberately service-role-only: the browser may submit
-- votes, but it cannot decide winners or advance the bracket.
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
  member_count integer;
  winner_id bigint;
  tie boolean := false;
  current_round integer;
  next_round integer;
  next_open timestamptz := public.mc_next_9am_pacific(now());
  survivor_count integer;
  bye_id bigint;
  pending_id bigint := null;
  entry_id bigint;
  next_matchups integer := 0;
  final_ids bigint[];
begin
  select * into matchup
  from public.bracket_matchups
  where id = p_matchup_id
  for update;
  if not found or matchup.status <> 'OPEN' then
    raise exception 'This matchup is not open';
  end if;

  if p_reason = 'timer' and matchup.closes_at is not null and matchup.closes_at > now() then
    raise exception 'This matchup timer has not expired';
  end if;

  select r.* into round_row
  from public.rounds r
  where r.id = matchup.round_id
  for update;

  select count(*)::integer into vote_count
  from public.bracket_votes
  where matchup_id = matchup.id;

  select count(*)::integer into member_count from public.members;

  if p_reason = 'timer' and vote_count < 3 then
    update public.bracket_matchups
    set closes_at = coalesce(closes_at, now()) + interval '24 hours'
    where id = matchup.id
    returning * into matchup;

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
    where x.entry_id is not null
    order by random()
    limit 1;
  end if;

  select count(*) > 1 into tie
  from (
    select count(*) as votes
    from public.bracket_votes
    where matchup_id = matchup.id
    group by entry_id
  ) tied
  where tied.votes = (
    select coalesce(max(votes), 0)
    from (
      select count(*) as votes
      from public.bracket_votes
      where matchup_id = matchup.id
      group by entry_id
    ) max_votes
  );

  select id into phase_id from public.round_phases
  where round_id = matchup.round_id and phase_type = 'BRACKET';

  if round_row.mode = 'scrambled'
     and matchup.entry_a_id is not null
     and matchup.entry_b_id is not null
     and not exists (
       select 1 from public.bracket_matchups other
       where other.round_id = matchup.round_id
         and other.bracket_round_number = matchup.bracket_round_number
         and other.id <> matchup.id
         and other.status <> 'CANCELLED'
     ) then
    final_ids := array[matchup.entry_a_id, matchup.entry_b_id];
    update public.bracket_matchups
    set status = 'CLOSED', winner_entry_id = null,
        result_entry_ids = final_ids,
        tie_resolved = tie,
        tie_resolution_note = case when tie then 'Randomly resolved tie; final two retained' else 'Final two retained' end
    where id = matchup.id
    returning * into matchup;
  else
    update public.bracket_matchups
    set status = 'CLOSED', winner_entry_id = winner_id,
        result_entry_ids = array[winner_id],
        tie_resolved = tie,
        tie_resolution_note = case when tie then 'Randomly selected winner' else null end
    where id = matchup.id
    returning * into matchup;
  end if;

  insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
  values (
    matchup.round_id, phase_id, p_actor_member_id,
    case when tie then 'MATCHUP_TIE_RESOLVED' else 'MATCHUP_RESOLVED' end,
    jsonb_build_object('matchup_id', matchup.id, 'winner_entry_id', matchup.winner_entry_id,
                       'result_entry_ids', matchup.result_entry_ids, 'votes', vote_count,
                       'reason', p_reason)
  );

  select count(*) into survivor_count
  from public.bracket_matchups bm
  where bm.round_id = matchup.round_id
    and bm.bracket_round_number = matchup.bracket_round_number
    and bm.status = 'CLOSED';

  if survivor_count < (select count(*) from public.bracket_matchups bm
                       where bm.round_id = matchup.round_id
                         and bm.bracket_round_number = matchup.bracket_round_number) then
    return matchup;
  end if;

  select max(bracket_round_number) into current_round
  from public.bracket_matchups where round_id = matchup.round_id;

  if round_row.mode = 'paired'
     and (select count(*) from public.bracket_matchups bm
          where bm.round_id = matchup.round_id
            and bm.bracket_round_number = matchup.bracket_round_number) = 1 then
    update public.round_phases
    set status = 'CLOSED', closes_at = now(), closed_reason = 'EVERYONE_COMPLETE'
    where id = phase_id;
    update public.rounds set status = 'COMPLETE', completed_at = now()
    where id = matchup.round_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    values (matchup.round_id, phase_id, p_actor_member_id, 'ROUND_COMPLETED',
            jsonb_build_object('mode', 'paired', 'winner_entry_id', matchup.winner_entry_id));
    return matchup;
  end if;

  if round_row.mode = 'scrambled' and current_round = matchup.bracket_round_number then
    select array_agg(x.entry_id order by x.entry_id) into final_ids
    from unnest(matchup.result_entry_ids) x(entry_id);
    if coalesce(array_length(final_ids, 1), 0) = 2 then
      update public.round_phases
      set status = 'CLOSED', closes_at = now(), closed_reason = 'EVERYONE_COMPLETE'
      where id = phase_id;
      update public.rounds set status = 'COMPLETE', completed_at = now()
      where id = matchup.round_id;
      insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
      values (matchup.round_id, phase_id, p_actor_member_id, 'ROUND_COMPLETED',
              jsonb_build_object('mode', 'scrambled', 'final_entry_ids', final_ids));
      return matchup;
    end if;
  end if;

  next_round := matchup.bracket_round_number + 1;
  for entry_id in
    select bm.winner_entry_id
    from public.bracket_matchups bm
    where bm.round_id = matchup.round_id
      and bm.bracket_round_number = matchup.bracket_round_number
      and bm.winner_entry_id is not null
    order by random()
  loop
    if pending_id is null then
      pending_id := entry_id;
    else
      insert into public.bracket_matchups (
        round_id, bracket_round_number, entry_a_id, entry_b_id, status,
        opens_at, closes_at
      ) values (
        matchup.round_id, next_round, pending_id, entry_id, 'OPEN',
        next_open, next_open + interval '24 hours'
      );
      next_matchups := next_matchups + 1;
      pending_id := null;
    end if;
  end loop;

  if pending_id is not null then
    update public.bracket_entries set bye_awarded = true where id = pending_id;
    insert into public.bracket_matchups (
      round_id, bracket_round_number, entry_a_id, status,
      opens_at, closes_at, winner_entry_id, result_entry_ids
    ) values (
      matchup.round_id, next_round, pending_id, 'CLOSED',
      next_open, next_open, pending_id, array[pending_id]
    );
  end if;

  if next_matchups = 0 and pending_id is null then
    update public.round_phases
    set status = 'CLOSED', closes_at = now(), closed_reason = 'EVERYONE_COMPLETE'
    where id = phase_id;
    update public.rounds set status = 'COMPLETE', completed_at = now()
    where id = matchup.round_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    values (matchup.round_id, phase_id, p_actor_member_id, 'ROUND_COMPLETED',
            jsonb_build_object('mode', round_row.mode, 'reason', 'final_winner'));
  else
    update public.round_phases
    set opens_at = next_open, closes_at = next_open + interval '24 hours'
    where id = phase_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    values (matchup.round_id, phase_id, p_actor_member_id, 'BRACKET_ROUND_OPENED',
            jsonb_build_object('bracket_round_number', next_round,
                               'matchup_count', next_matchups, 'opens_at', next_open));
  end if;

  return matchup;
end;
$$;

revoke all on function public.mc_resolve_matchup(bigint, bigint, text) from public;
grant execute on function public.mc_resolve_matchup(bigint, bigint, text) to service_role;

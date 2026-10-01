-- Round admin hardening using the existing rounds/phases model.
-- Fixes mode-after-spin creation, makes default_duration_hours effective for
-- every phase/bracket window, and allows permanent deletion only after archive.

create or replace function public.mc_round_duration(p_round_id bigint)
returns interval
language sql
stable
set search_path = public
as $$
  select make_interval(hours => greatest(coalesce(default_duration_hours, 24), 1))
  from public.rounds
  where id = p_round_id
$$;

create or replace function public.mc_create_round(
  p_month_key text,
  p_mode text,
  p_created_by bigint default null,
  p_open_at timestamptz default null,
  p_default_duration_hours integer default 24
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.rounds;
  round_id bigint;
  open_at timestamptz := coalesce(p_open_at, public.mc_next_9am_pacific(now()));
  phase_type text;
  phase_status text;
  phase_open timestamptz;
  duration_hours integer := greatest(coalesce(p_default_duration_hours, 24), 1);
begin
  if p_mode is not null and p_mode not in ('scrambled', 'paired') then
    raise exception 'Mode must be scrambled or paired';
  end if;

  insert into public.rounds (
    month_key, status, mode, default_duration_hours, timezone, next_open_at, created_by
  ) values (
    p_month_key, 'ACTIVE', p_mode, duration_hours, 'America/Los_Angeles', open_at, p_created_by
  ) returning * into result;

  round_id := result.id;
  foreach phase_type in array array[
    'CATEGORY_SUBMISSIONS', 'CATEGORY_SPIN', 'MOVIE_SUBMISSIONS', 'BRACKET'
  ] loop
    phase_status := case when phase_type = 'CATEGORY_SUBMISSIONS' then 'OPEN' else 'DRAFT' end;
    phase_open := case when phase_type = 'CATEGORY_SUBMISSIONS' then open_at else null end;
    insert into public.round_phases (
      round_id, phase_type, status, opens_at, closes_at
    ) values (
      round_id, phase_type, phase_status, phase_open,
      case when phase_open is null then null else phase_open + public.mc_round_duration(round_id) end
    );
  end loop;

  insert into public.round_events (round_id, event_type, actor_member_id, payload)
  values (
    round_id, 'ROUND_CREATED', p_created_by,
    jsonb_build_object('month_key', p_month_key, 'mode', p_mode, 'opens_at', open_at)
  );

  return result;
end;
$$;

create or replace function public.mc_advance_phase(
  p_phase_id bigint,
  p_actor_member_id bigint,
  p_reason text default 'admin'
)
returns public.round_phases
language plpgsql
security definer
set search_path = public
as $$
declare
  current_phase public.round_phases;
  next_phase public.round_phases;
  next_type text;
  next_open timestamptz;
begin
  select * into current_phase
  from public.round_phases
  where id = p_phase_id
  for update;

  if not found or current_phase.status not in ('OPEN', 'CLOSED') then
    raise exception 'Phase cannot be advanced';
  end if;

  if current_phase.phase_type = 'CATEGORY_SPIN' then
    raise exception 'Choose a bracket mode and open the movie stage after category spinning';
  end if;

  update public.round_phases
  set status = 'CLOSED',
      closes_at = coalesce(closes_at, now()),
      closed_reason = case when p_reason = 'timer' then 'TIMER' else 'ADMIN' end,
      advanced_by = p_actor_member_id,
      advance_reason = p_reason
  where id = current_phase.id;

  next_type := public.mc_next_phase_type(current_phase.phase_type);
  if next_type is null then
    update public.rounds
    set status = 'COMPLETE', completed_at = now()
    where id = current_phase.round_id;

    insert into public.round_events (round_id, phase_id, event_type, actor_member_id, payload)
    values (
      current_phase.round_id,
      current_phase.id,
      'ROUND_COMPLETED',
      p_actor_member_id,
      jsonb_build_object('reason', p_reason)
    );
    return current_phase;
  end if;

  -- Manual admin advances override the minimum-response rule and open now.
  -- Automated transitions keep the fixed next-day 9 AM Pacific schedule.
  next_open := case
    when p_reason = 'admin' then now()
    else public.mc_next_9am_pacific(now())
  end;

  update public.round_phases
  set status = 'OPEN',
      opens_at = next_open,
      closes_at = case
        when p_reason = 'admin' then next_open + public.mc_round_duration(current_phase.round_id)
        else next_open + public.mc_round_duration(current_phase.round_id)
      end,
      closed_reason = null
  where round_id = current_phase.round_id
    and phase_type = next_type
  returning * into next_phase;

  if not found then
    raise exception 'Next phase not found';
  end if;

  insert into public.round_events (round_id, phase_id, event_type, actor_member_id, payload)
  values (
    current_phase.round_id,
    next_phase.id,
    'PHASE_OPENED',
    p_actor_member_id,
    jsonb_build_object(
      'phase_type', next_type,
      'opens_at', next_open,
      'reason', p_reason,
      'manual_override', (p_reason = 'admin')
    )
  );

  return next_phase;
end;
$$;

create or replace function public.mc_open_movie_stage(
  p_round_id bigint,
  p_mode text,
  p_actor_member_id bigint
)
returns public.round_phases
language plpgsql
security definer
set search_path = public
as $$
declare
  round_row public.rounds;
  spin_phase public.round_phases;
  movie_phase public.round_phases;
  open_at timestamptz := now();
  spin_count integer;
  tied_categories text[];
  winning_category text;
begin
  if p_mode not in ('paired', 'scrambled') then
    raise exception 'Mode must be paired or scrambled';
  end if;

  select * into round_row
  from public.rounds
  where id = p_round_id and status = 'ACTIVE'
  for update;
  if not found then raise exception 'Active round not found'; end if;

  select * into spin_phase
  from public.round_phases
  where round_id = p_round_id and phase_type = 'CATEGORY_SPIN'
  for update;
  if not found or spin_phase.status not in ('OPEN', 'CLOSED') then
    raise exception 'Category spin must be open or closed before movie stage';
  end if;

  select * into movie_phase
  from public.round_phases
  where round_id = p_round_id and phase_type = 'MOVIE_SUBMISSIONS'
  for update;
  if not found then raise exception 'Movie submission phase not found'; end if;

  select count(*)::integer into spin_count
  from public.category_spins
  where phase_id = spin_phase.id;
  if spin_count < 1 then
    raise exception 'At least one category spin is required before opening movie submissions';
  end if;

  with counts as (
    select result_category, count(*)::integer as weight
    from public.category_spins
    where phase_id = spin_phase.id
    group by result_category
  )
  select array_agg(result_category order by result_category)
  into tied_categories
  from counts
  where weight = (select max(weight) from counts);

  winning_category := tied_categories[1 + floor(random() * array_length(tied_categories, 1))::integer];

  update public.rounds
  set mode = p_mode
  where id = p_round_id;

  update public.round_phases
  set status = 'CLOSED',
      closes_at = coalesce(closes_at, now()),
      closed_reason = 'ADMIN',
      advanced_by = p_actor_member_id,
      advance_reason = 'admin selected ' || p_mode
  where id = spin_phase.id;

  update public.round_phases
  set status = 'OPEN',
      opens_at = open_at,
      closes_at = open_at + public.mc_round_duration(p_round_id),
      closed_reason = null
  where id = movie_phase.id
  returning * into movie_phase;

  insert into public.round_events (
    round_id, phase_id, actor_member_id, event_type, payload
  ) values (
    p_round_id, spin_phase.id, p_actor_member_id, 'CATEGORY_WINNER_SELECTED',
    jsonb_build_object(
      'category', winning_category,
      'tie', array_length(tied_categories, 1) > 1,
      'tied_categories', tied_categories,
      'spin_count', spin_count
    )
  );

  insert into public.round_events (
    round_id, phase_id, actor_member_id, event_type, payload
  ) values (
    p_round_id, movie_phase.id, p_actor_member_id, 'MOVIE_STAGE_OPENED',
    jsonb_build_object('mode', p_mode, 'opens_at', open_at, 'manual_override', true)
  );

  return movie_phase;
end;
$$;

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
      closes_at = now() + public.mc_round_duration(result.round_id),
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
  select coalesce(opens_at, bracket_open) into bracket_open
  from public.round_phases where id = bracket_phase_id;

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
        'OPEN', bracket_open, bracket_open + public.mc_round_duration(p_round_id)
      );
      matchup_count := matchup_count + 1;
      pending_entry_id := null;
    end if;
  end loop;

  update public.round_phases
  set status = 'OPEN', opens_at = bracket_open,
      closes_at = bracket_open + public.mc_round_duration(p_round_id)
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

create or replace function public.mc_resolve_matchup(
  p_matchup_id bigint, p_actor_member_id bigint, p_reason text default 'timer'
)
returns public.bracket_matchups
language plpgsql security definer set search_path = public
as $$
declare
  matchup public.bracket_matchups; phase_id bigint; round_row public.rounds;
  vote_count integer; winner_id bigint; tie boolean := false;
  current_round integer; next_round integer;
  next_open timestamptz := public.mc_next_9am_pacific(now());
  survivor_count integer; pending_id bigint := null; entry_id bigint;
  next_matchups integer := 0; final_ids bigint[];
begin
  select * into matchup from public.bracket_matchups where id = p_matchup_id for update;
  if not found or matchup.status <> 'OPEN' then raise exception 'This matchup is not open'; end if;
  if p_reason = 'timer' and matchup.closes_at is not null and matchup.closes_at > now() then
    raise exception 'This matchup timer has not expired';
  end if;
  select r.* into round_row from public.rounds r where r.id = matchup.round_id for update;
  select count(*)::integer into vote_count from public.bracket_votes where matchup_id = matchup.id;
  if p_reason = 'timer' and vote_count < 3 then
    update public.bracket_matchups set closes_at = coalesce(closes_at, now()) + public.mc_round_duration(matchup.round_id)
    where id = matchup.id returning * into matchup;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
    select matchup.round_id, rp.id, p_actor_member_id, 'MATCHUP_MINIMUM_NOT_MET',
      jsonb_build_object('matchup_id', matchup.id, 'votes', vote_count, 'required', 3, 'new_closes_at', matchup.closes_at)
    from public.round_phases rp where rp.round_id = matchup.round_id and rp.phase_type = 'BRACKET';
    return matchup;
  end if;
  select v.entry_id into winner_id from public.bracket_votes v where v.matchup_id = matchup.id
    group by v.entry_id order by count(*) desc, random() limit 1;
  if winner_id is null then
    select x.entry_id into winner_id from (values (matchup.entry_a_id), (matchup.entry_b_id)) x(entry_id)
    where x.entry_id is not null order by random() limit 1;
  end if;
  select count(*) > 1 into tie from (
    select count(*) as votes from public.bracket_votes where matchup_id = matchup.id
    group by public.bracket_votes.entry_id
  ) tied where tied.votes = (select coalesce(max(votes), 0) from (
    select count(*) as votes from public.bracket_votes where matchup_id = matchup.id
    group by public.bracket_votes.entry_id
  ) max_votes);
  select id into phase_id from public.round_phases where round_id = matchup.round_id and phase_type = 'BRACKET';
  update public.bracket_matchups set status = 'CLOSED', winner_entry_id = winner_id,
    result_entry_ids = array[winner_id], tie_resolved = tie,
    tie_resolution_note = case when tie then 'Randomly selected winner' else null end
  where id = matchup.id returning * into matchup;
  insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
  values (matchup.round_id, phase_id, p_actor_member_id,
    case when tie then 'MATCHUP_TIE_RESOLVED' else 'MATCHUP_RESOLVED' end,
    jsonb_build_object('matchup_id', matchup.id, 'winner_entry_id', matchup.winner_entry_id,
      'result_entry_ids', matchup.result_entry_ids, 'votes', vote_count, 'reason', p_reason));
  if exists (select 1 from public.bracket_matchups bm where bm.round_id = matchup.round_id
    and bm.bracket_round_number = matchup.bracket_round_number and bm.status = 'OPEN') then return matchup; end if;
  select max(bracket_round_number) into current_round from public.bracket_matchups where round_id = matchup.round_id;
  select count(*) into survivor_count from public.bracket_matchups bm where bm.round_id = matchup.round_id
    and bm.bracket_round_number = current_round and bm.winner_entry_id is not null;
  if round_row.mode = 'paired' and survivor_count = 1 then
    update public.round_phases set status = 'CLOSED', closes_at = now(), closed_reason = 'EVERYONE_COMPLETE' where id = phase_id;
    update public.rounds set status = 'COMPLETE', completed_at = now() where id = matchup.round_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload) values (matchup.round_id, phase_id, p_actor_member_id, 'ROUND_COMPLETED',
      jsonb_build_object('mode', 'paired', 'winner_entry_id', matchup.winner_entry_id));
    return matchup;
  end if;
  if round_row.mode = 'scrambled' and (select count(*) from public.bracket_matchups bm
    where bm.round_id = matchup.round_id and bm.bracket_round_number = current_round) = 1
    and matchup.entry_a_id is not null and matchup.entry_b_id is not null then
    final_ids := array[matchup.entry_a_id, matchup.entry_b_id];
    update public.round_phases set status = 'CLOSED', closes_at = now(), closed_reason = 'EVERYONE_COMPLETE' where id = phase_id;
    update public.rounds set status = 'COMPLETE', completed_at = now() where id = matchup.round_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload) values (matchup.round_id, phase_id, p_actor_member_id, 'ROUND_COMPLETED',
      jsonb_build_object('mode', 'scrambled', 'final_entry_ids', final_ids));
    return matchup;
  end if;
  next_round := current_round + 1;
  for entry_id in select bm.winner_entry_id from public.bracket_matchups bm
    where bm.round_id = matchup.round_id and bm.bracket_round_number = current_round
      and bm.winner_entry_id is not null order by random() loop
    if pending_id is null then pending_id := entry_id; else
      insert into public.bracket_matchups (round_id, bracket_round_number, entry_a_id, entry_b_id, status, opens_at, closes_at)
      values (matchup.round_id, next_round, pending_id, entry_id, 'OPEN', next_open, next_open + public.mc_round_duration(matchup.round_id));
      next_matchups := next_matchups + 1; pending_id := null;
    end if;
  end loop;
  if pending_id is not null then
    update public.bracket_entries set bye_awarded = true where id = pending_id;
    insert into public.bracket_matchups (round_id, bracket_round_number, entry_a_id, status, opens_at, closes_at, winner_entry_id, result_entry_ids)
    values (matchup.round_id, next_round, pending_id, 'CLOSED', next_open, next_open, pending_id, array[pending_id]);
  end if;
  if next_matchups = 0 and pending_id is null then
    update public.round_phases set status = 'CLOSED', closes_at = now(), closed_reason = 'EVERYONE_COMPLETE' where id = phase_id;
    update public.rounds set status = 'COMPLETE', completed_at = now() where id = matchup.round_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload) values (matchup.round_id, phase_id, p_actor_member_id, 'ROUND_COMPLETED',
      jsonb_build_object('mode', round_row.mode, 'reason', 'final_winner'));
  else
    update public.round_phases set opens_at = next_open, closes_at = next_open + public.mc_round_duration(matchup.round_id) where id = phase_id;
    insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload) values (matchup.round_id, phase_id, p_actor_member_id, 'BRACKET_ROUND_OPENED',
      jsonb_build_object('bracket_round_number', next_round, 'matchup_count', next_matchups, 'opens_at', next_open));
  end if;
  return matchup;
end;
$$;

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
      closes_at = case when entry_a_id is not null and entry_b_id is not null then now() + public.mc_round_duration(p_round_id) else closes_at end,
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
  set status = 'OPEN', opens_at = now(), closes_at = now() + public.mc_round_duration(p_round_id),
      closed_reason = null, reopened_at = now(), reopened_by = p_actor_member_id
  where id = bracket_phase.id;
  update public.rounds set status = 'ACTIVE', completed_at = null where id = p_round_id;

  insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
  values (p_round_id, bracket_phase.id, p_actor_member_id, 'BRACKET_ROUND_REOPENED',
    jsonb_build_object('bracket_round_number', p_bracket_round_number,
      'reopened_matchups', reopened_count, 'cancelled_downstream_matchups', cancelled_count,
      'new_closes_at', now() + public.mc_round_duration(p_round_id)));

  return jsonb_build_object('round_id', p_round_id, 'bracket_round_number', p_bracket_round_number,
    'status', 'OPEN', 'reopened_matchups', reopened_count,
    'cancelled_downstream_matchups', cancelled_count);
end;
$$;

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
    set status = 'OPEN', opens_at = now(), closes_at = now() + public.mc_round_duration(p_round_id)
    where id = bracket_phase.id
    returning * into updated_phase;

    update public.bracket_matchups
    set opens_at = now(), closes_at = now() + public.mc_round_duration(p_round_id)
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

-- The older immediate wrapper was later replaced by the scrambled-final
-- migration. Keep that final-two behavior, while restoring the intended
-- manual-advance behavior for every non-final bracket round.
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
  set opens_at = now(), closes_at = now() + public.mc_round_duration(result_matchup.round_id)
  where id = bracket_phase_id
    and status = 'OPEN'
    and exists (
      select 1 from public.bracket_matchups
      where round_id = result_matchup.round_id
        and bracket_round_number = next_bracket_round
        and status = 'OPEN'
    );

  update public.bracket_matchups
  set opens_at = now(), closes_at = now() + public.mc_round_duration(result_matchup.round_id)
  where round_id = result_matchup.round_id
    and bracket_round_number = next_bracket_round
    and status = 'OPEN';

  return result_matchup;
end;
$$;

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
      set closes_at = coalesce(closes_at, now()) + public.mc_round_duration(phase_row.round_id),
          closed_reason = 'MINIMUM_NOT_MET'
      where id = phase_row.id;

      insert into public.round_events (round_id, phase_id, event_type, payload)
      values (
        phase_row.round_id, phase_row.id, 'PHASE_MINIMUM_NOT_MET',
        jsonb_build_object('actions', action_count, 'required', 3,
                           'new_closes_at', phase_row.closes_at + public.mc_round_duration(phase_row.round_id))
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

create or replace function public.mc_create_round_at_movie_stage(
  p_month_key text,
  p_mode text,
  p_category text,
  p_created_by bigint,
  p_default_duration_hours integer default 24
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.rounds;
  category_phase_id bigint;
  spin_phase_id bigint;
begin
  if length(trim(coalesce(p_category, ''))) not between 1 and 120 then
    raise exception 'Category must be between 1 and 120 characters';
  end if;

  result := public.mc_create_round(
    p_month_key, p_mode, p_created_by, now(), p_default_duration_hours
  );

  select id into category_phase_id
  from public.round_phases
  where round_id = result.id and phase_type = 'CATEGORY_SUBMISSIONS';
  if category_phase_id is null then raise exception 'Category phase not found'; end if;

  perform public.mc_submit_category(category_phase_id, p_created_by, p_category);
  perform public.mc_advance_phase(category_phase_id, p_created_by, 'admin');

  select id into spin_phase_id
  from public.round_phases
  where round_id = result.id and phase_type = 'CATEGORY_SPIN';
  if spin_phase_id is null then raise exception 'Category spin phase not found'; end if;

  perform public.mc_spin_category(spin_phase_id, p_created_by);
  perform public.mc_open_movie_stage(result.id, p_mode, p_created_by);

  select * into result from public.rounds where id = result.id;
  return result;
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
  desired_open timestamptz;
begin
  select id, opens_at into bracket_phase_id, desired_open
  from public.round_phases
  where round_id = p_round_id and phase_type = 'BRACKET'
  for update;
  if not found then raise exception 'Bracket phase not found'; end if;

  desired_open := coalesce(desired_open, now());
  matchup_count := public.mc_build_bracket(p_round_id, p_actor_member_id);

  update public.round_phases
  set opens_at = desired_open,
      closes_at = desired_open + public.mc_round_duration(p_round_id)
  where id = bracket_phase_id;

  update public.bracket_matchups
  set opens_at = desired_open,
      closes_at = desired_open + public.mc_round_duration(p_round_id)
  where round_id = p_round_id
    and bracket_round_number = 1
    and status = 'OPEN';

  return matchup_count;
end;
$$;

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

  if round_row.mode is null and spin_phase.status = 'CLOSED' and movie_phase.status = 'DRAFT'
     and not exists (select 1 from public.movie_submissions ms where ms.phase_id = movie_phase.id)
     and not exists (select 1 from public.bracket_entries be where be.round_id = p_round_id) then
    delete from public.category_spins where phase_id = spin_phase.id;
    update public.round_phases
    set status = 'OPEN', opens_at = now(), closes_at = now() + public.mc_round_duration(p_round_id),
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
  if not found then raise exception 'No undoable round result was found'; end if;

  if exists (select 1 from public.bracket_matchups where round_id = p_round_id and status = 'OPEN')
     or exists (select 1 from public.bracket_matchups
                where round_id = p_round_id and bracket_round_number > last_matchup.bracket_round_number) then
    raise exception 'Undo is only available for the latest completed matchup before a later bracket round opens';
  end if;

  delete from public.bracket_votes where matchup_id = last_matchup.id;
  update public.bracket_matchups
  set status = 'OPEN', opens_at = now(), closes_at = now() + public.mc_round_duration(p_round_id),
      winner_entry_id = null, result_entry_ids = '{}', tie_resolved = false, tie_resolution_note = null
  where id = last_matchup.id;

  select * into bracket_phase from public.round_phases
  where round_id = p_round_id and phase_type = 'BRACKET';
  update public.round_phases
  set status = 'OPEN', opens_at = now(), closes_at = now() + public.mc_round_duration(p_round_id),
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

create or replace function public.mc_delete_round(
  p_round_id bigint,
  p_actor_member_id bigint
)
returns public.rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.rounds;
begin
  delete from public.rounds
  where id = p_round_id
    and status = 'CANCELLED'
    and archived_at is not null
  returning * into result;

  if not found then
    raise exception 'Only an archived round can be permanently deleted';
  end if;

  return result;
end;
$$;

revoke all on function public.mc_round_duration(bigint) from public;
revoke all on function public.mc_create_round(text, text, bigint, timestamptz) from public;
revoke all on function public.mc_create_round(text, text, bigint, timestamptz, integer) from public;
revoke all on function public.mc_create_round_at_movie_stage(text, text, text, bigint, integer) from public;
revoke all on function public.mc_undo_last_round_result(bigint, bigint) from public;
revoke all on function public.mc_delete_round(bigint, bigint) from public;
revoke all on function public.mc_resolve_matchup_immediate(bigint, bigint) from public;

grant execute on function public.mc_round_duration(bigint) to service_role;
grant execute on function public.mc_create_round(text, text, bigint, timestamptz, integer) to service_role;
grant execute on function public.mc_create_round_at_movie_stage(text, text, text, bigint, integer) to service_role;
grant execute on function public.mc_build_bracket_immediate(bigint, bigint) to service_role;
grant execute on function public.mc_undo_last_round_result(bigint, bigint) to service_role;
grant execute on function public.mc_delete_round(bigint, bigint) to service_role;
grant execute on function public.mc_resolve_matchup_immediate(bigint, bigint) to service_role;

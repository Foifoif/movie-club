-- Construct the first bracket from the completed movie-submission phase.
-- Matchup resolution/advancement is kept separate so each bracket round can
-- be tested and audited independently.

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

  delete from public.bracket_matchups where round_id = p_round_id;
  delete from public.bracket_entries where round_id = p_round_id;

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
      round_id, entry_type, movie_a_tmdb_id, movie_a_title, seed
    )
    select p_round_id, 'MOVIE', tmdb_id, title,
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
      movie_a_title, movie_b_title, seed
    )
    select p_round_id, 'PAIR', member_id,
           a_tmdb_id, b_tmdb_id, a_title, b_title,
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

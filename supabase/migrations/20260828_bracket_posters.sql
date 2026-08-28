-- Store the submitted poster URLs on bracket entries and backfill the
-- currently-built bracket from its movie-submission phase.

alter table public.bracket_entries
  add column if not exists movie_a_poster text,
  add column if not exists movie_b_poster text;

update public.bracket_entries e
set movie_a_poster = coalesce(
  e.movie_a_poster,
  (
    select ms.poster
    from public.movie_submissions ms
    join public.round_phases rp on rp.id = ms.phase_id
    where rp.round_id = e.round_id
      and rp.phase_type = 'MOVIE_SUBMISSIONS'
      and (
        (e.entry_type = 'PAIR' and ms.member_id = e.source_member_id and ms.slot = 1)
        or (e.entry_type = 'MOVIE' and (
          (e.movie_a_tmdb_id is not null and ms.tmdb_id = e.movie_a_tmdb_id)
          or (e.movie_a_tmdb_id is null and lower(trim(ms.title)) = lower(trim(e.movie_a_title)))
        ))
      )
    order by ms.updated_at desc
    limit 1
  )
),
movie_b_poster = coalesce(
  e.movie_b_poster,
  (
    select ms.poster
    from public.movie_submissions ms
    join public.round_phases rp on rp.id = ms.phase_id
    where rp.round_id = e.round_id
      and rp.phase_type = 'MOVIE_SUBMISSIONS'
      and e.entry_type = 'PAIR'
      and ms.member_id = e.source_member_id
      and ms.slot = 2
    order by ms.updated_at desc
    limit 1
  )
)
where e.movie_a_poster is null or (e.entry_type = 'PAIR' and e.movie_b_poster is null);

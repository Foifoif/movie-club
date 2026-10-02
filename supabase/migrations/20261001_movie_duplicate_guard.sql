-- Reuse movie identities already stored in movies. Do not merge/delete rows.
-- Index creation fails safely if conflicting historical data exists.
create unique index if not exists movies_unique_tmdb_id
  on public.movies (tmdb_id) where tmdb_id is not null;

-- Legacy entries without a TMDB identifier use normalized title + release year.
create unique index if not exists movies_unique_legacy_identity
  on public.movies (lower(regexp_replace(btrim(title), '[[:space:]]+', ' ', 'g')), coalesce(year, 0))
  where tmdb_id is null;

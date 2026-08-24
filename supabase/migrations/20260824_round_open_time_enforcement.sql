-- Do not allow a phase or matchup to be used before its scheduled open time.

create or replace function public.mc_submit_category(
  p_phase_id bigint, p_member_id bigint, p_text text
)
returns public.category_submissions
language plpgsql security definer set search_path = public
as $$
declare result public.category_submissions;
begin
  if length(trim(coalesce(p_text, ''))) not between 1 and 120 then
    raise exception 'Category must be between 1 and 120 characters';
  end if;
  if not exists (select 1 from public.round_phases where id = p_phase_id
    and phase_type = 'CATEGORY_SUBMISSIONS' and status = 'OPEN'
    and (opens_at is null or opens_at <= now())) then
    raise exception 'Category submissions are not open';
  end if;
  insert into public.category_submissions (phase_id, member_id, raw_text, normalized_text)
  values (p_phase_id, p_member_id, trim(p_text), public.mc_normalize_category(p_text))
  on conflict (phase_id, member_id) do update
    set raw_text = excluded.raw_text, normalized_text = excluded.normalized_text, updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.mc_spin_category(
  p_phase_id bigint, p_member_id bigint
)
returns public.category_spins
language plpgsql security definer set search_path = public
as $$
declare
  result public.category_spins; chosen record; total_weight integer; draw integer;
begin
  if not exists (select 1 from public.round_phases where id = p_phase_id
    and phase_type = 'CATEGORY_SPIN' and status = 'OPEN'
    and (opens_at is null or opens_at <= now())) then
    raise exception 'Category spinning is not open';
  end if;
  select * into result from public.category_spins where phase_id = p_phase_id and member_id = p_member_id;
  if found then return result; end if;
  select coalesce(sum(weight), 0) into total_weight from (
    select normalized_text, count(*)::integer as weight
    from public.category_submissions cs join public.round_phases rp on rp.id = cs.phase_id
    where rp.round_id = (select round_id from public.round_phases where id = p_phase_id)
      and rp.phase_type = 'CATEGORY_SUBMISSIONS' group by normalized_text
  ) weighted;
  if total_weight < 1 then raise exception 'No category submissions exist'; end if;
  draw := floor(random() * total_weight)::integer + 1;
  select normalized_text, weight into chosen from (
    select normalized_text, count(*)::integer as weight,
      sum(count(*)) over (order by normalized_text)::integer as cumulative_weight
    from public.category_submissions cs join public.round_phases rp on rp.id = cs.phase_id
    where rp.round_id = (select round_id from public.round_phases where id = p_phase_id)
      and rp.phase_type = 'CATEGORY_SUBMISSIONS' group by normalized_text
  ) weighted where cumulative_weight >= draw order by cumulative_weight limit 1;
  insert into public.category_spins (phase_id, member_id, result_category, result_weight, random_receipt)
  values (p_phase_id, p_member_id, chosen.normalized_text, chosen.weight,
          md5(random()::text || clock_timestamp()::text || p_member_id::text)) returning * into result;
  insert into public.round_events (round_id, phase_id, actor_member_id, event_type, payload)
  values ((select round_id from public.round_phases where id = p_phase_id), p_phase_id, p_member_id,
          'CATEGORY_SPIN_RECORDED', jsonb_build_object('category', result.result_category, 'weight', result.result_weight));
  return result;
end;
$$;

create or replace function public.mc_submit_movie(
  p_phase_id bigint, p_member_id bigint, p_slot smallint, p_tmdb_id bigint,
  p_title text, p_year integer default null, p_poster text default null
)
returns public.movie_submissions
language plpgsql security definer set search_path = public
as $$
declare result public.movie_submissions;
begin
  if p_slot not in (1, 2) or length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'Two valid movie selections are required';
  end if;
  if not exists (select 1 from public.round_phases where id = p_phase_id
    and phase_type = 'MOVIE_SUBMISSIONS' and status = 'OPEN'
    and (opens_at is null or opens_at <= now())) then
    raise exception 'Movie submissions are not open';
  end if;
  insert into public.movie_submissions (phase_id, member_id, slot, tmdb_id, title, year, poster)
  values (p_phase_id, p_member_id, p_slot, p_tmdb_id, trim(p_title), p_year, p_poster)
  on conflict (phase_id, member_id, slot) do update
    set tmdb_id = excluded.tmdb_id, title = excluded.title, year = excluded.year,
        poster = excluded.poster, updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.mc_vote_matchup(
  p_matchup_id bigint, p_member_id bigint, p_entry_id bigint
)
returns public.bracket_votes
language plpgsql security definer set search_path = public
as $$
declare result public.bracket_votes; matchup public.bracket_matchups;
begin
  select * into matchup from public.bracket_matchups where id = p_matchup_id;
  if not found or matchup.status <> 'OPEN'
     or (matchup.opens_at is not null and matchup.opens_at > now()) then
    raise exception 'This matchup is not open';
  end if;
  if p_entry_id not in (matchup.entry_a_id, matchup.entry_b_id) then
    raise exception 'Vote must select one of the matchup entries';
  end if;
  insert into public.bracket_votes (matchup_id, member_id, entry_id)
  values (p_matchup_id, p_member_id, p_entry_id)
  on conflict (matchup_id, member_id) do update set entry_id = excluded.entry_id, created_at = now()
  returning * into result;
  return result;
end;
$$;

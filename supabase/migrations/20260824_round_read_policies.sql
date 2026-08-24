-- Read-only access for the private club UI. All writes continue through the
-- server-side RPCs and service-role transition functions.

do $$
begin
  execute 'drop policy if exists rounds_read on public.rounds';
  execute 'create policy rounds_read on public.rounds for select to anon, authenticated using (true)';
  execute 'drop policy if exists round_phases_read on public.round_phases';
  execute 'create policy round_phases_read on public.round_phases for select to anon, authenticated using (true)';
  execute 'drop policy if exists category_submissions_read on public.category_submissions';
  execute 'create policy category_submissions_read on public.category_submissions for select to anon, authenticated using (true)';
  execute 'drop policy if exists category_spins_read on public.category_spins';
  execute 'create policy category_spins_read on public.category_spins for select to anon, authenticated using (true)';
  execute 'drop policy if exists movie_submissions_read on public.movie_submissions';
  execute 'create policy movie_submissions_read on public.movie_submissions for select to anon, authenticated using (true)';
  execute 'drop policy if exists bracket_entries_read on public.bracket_entries';
  execute 'create policy bracket_entries_read on public.bracket_entries for select to anon, authenticated using (true)';
  execute 'drop policy if exists bracket_matchups_read on public.bracket_matchups';
  execute 'create policy bracket_matchups_read on public.bracket_matchups for select to anon, authenticated using (true)';
  execute 'drop policy if exists bracket_votes_read on public.bracket_votes';
  execute 'create policy bracket_votes_read on public.bracket_votes for select to anon, authenticated using (true)';
  execute 'drop policy if exists round_events_read on public.round_events';
  execute 'create policy round_events_read on public.round_events for select to anon, authenticated using (true)';
  execute 'drop policy if exists home_notifications_read on public.home_notifications';
  execute 'create policy home_notifications_read on public.home_notifications for select to anon, authenticated using (true)';
end $$;

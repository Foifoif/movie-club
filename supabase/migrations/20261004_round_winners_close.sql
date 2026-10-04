-- Voting completion and administrative close-out are separate actions.
-- Reuse COMPLETE + archived_at; preserve all winner/vote/submission records.
create or replace function public.mc_archive_round(p_round_id bigint, p_actor_member_id bigint)
returns public.rounds
language plpgsql security definer set search_path = public
as $$
declare
  result public.rounds;
begin
  select * into result from public.rounds where id = p_round_id for update;
  if not found or result.status not in ('DRAFT', 'ACTIVE', 'COMPLETE') then
    raise exception 'Only a current or completed round can be closed';
  end if;
  if result.archived_at is not null then return result; end if;

  update public.rounds
  set status = case when status = 'COMPLETE' then 'COMPLETE' else 'CANCELLED' end,
      cancelled_at = case when status = 'COMPLETE' then cancelled_at else now() end,
      archived_at = now(), archived_by = p_actor_member_id
  where id = p_round_id returning * into result;

  update public.round_phases
  set status = case when status = 'OPEN' then 'CLOSED' else status end,
      closes_at = case when status = 'OPEN' then now() else closes_at end,
      closed_reason = case when status = 'OPEN' then 'ADMIN' else closed_reason end,
      advanced_by = case when status = 'OPEN' then p_actor_member_id else advanced_by end,
      advance_reason = case when status = 'OPEN' then 'admin archived round' else advance_reason end
  where round_id = p_round_id and status in ('OPEN', 'DRAFT');

  insert into public.round_events (round_id, actor_member_id, event_type, payload)
  values (p_round_id, p_actor_member_id,
    case when result.status = 'COMPLETE' then 'ROUND_CLOSED' else 'ROUND_ARCHIVED' end,
    jsonb_build_object('archived_at', result.archived_at, 'reason', 'admin closed current round'));
  return result;
end;
$$;
revoke all on function public.mc_archive_round(bigint, bigint) from public, anon, authenticated;
grant execute on function public.mc_archive_round(bigint, bigint) to service_role;

-- Existing reopen/undo functions reactivate COMPLETE rounds. Clear only their
-- close-out metadata so finishing that reopened round shows its new winners.
create or replace function public.mc_clear_round_close_on_reopen()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'COMPLETE' and new.status = 'ACTIVE' then
    new.archived_at := null;
    new.archived_by := null;
  end if;
  return new;
end;
$$;
create or replace trigger round_clear_close_on_reopen
before update of status on public.rounds
for each row execute function public.mc_clear_round_close_on_reopen();

notify pgrst, 'reload schema';

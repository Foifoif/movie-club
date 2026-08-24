-- Archive a current round without removing any submissions, spins, votes,
-- bracket entries, matchups, or history events.

alter table public.rounds
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by bigint references public.members(id) on delete set null;

create or replace function public.mc_archive_round(
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
  update public.rounds
  set status = 'CANCELLED',
      cancelled_at = now(),
      archived_at = now(),
      archived_by = p_actor_member_id
  where id = p_round_id and status in ('DRAFT', 'ACTIVE')
  returning * into result;

  if not found then
    raise exception 'Only a current draft or active round can be archived';
  end if;

  update public.round_phases
  set status = case when status = 'OPEN' then 'CLOSED' else status end,
      closes_at = case when status = 'OPEN' then now() else closes_at end,
      closed_reason = case when status = 'OPEN' then 'ADMIN' else closed_reason end,
      advanced_by = case when status = 'OPEN' then p_actor_member_id else advanced_by end,
      advance_reason = case when status = 'OPEN' then 'admin archived round' else advance_reason end
  where round_id = p_round_id and status in ('OPEN', 'DRAFT');

  insert into public.round_events (round_id, actor_member_id, event_type, payload)
  values (p_round_id, p_actor_member_id, 'ROUND_ARCHIVED',
          jsonb_build_object('archived_at', result.archived_at, 'reason', 'admin archived current round'));

  return result;
end;
$$;

revoke all on function public.mc_archive_round(bigint, bigint) from public;
grant execute on function public.mc_archive_round(bigint, bigint) to service_role;

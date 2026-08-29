-- Keep the manual bracket action compatible with an older frontend payload
-- that still includes p_reason.

create or replace function public.mc_resolve_matchup_immediate(
  p_matchup_id bigint,
  p_actor_member_id bigint,
  p_reason text
)
returns public.bracket_matchups
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.mc_resolve_matchup_immediate(p_matchup_id, p_actor_member_id);
end;
$$;

revoke all on function public.mc_resolve_matchup_immediate(bigint, bigint, text) from public;
grant execute on function public.mc_resolve_matchup_immediate(bigint, bigint, text) to service_role;

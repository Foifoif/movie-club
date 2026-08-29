-- Repair the existing resolver in place. Its PL/pgSQL variable named entry_id
-- collides with bracket_votes.entry_id in two tie-count queries. Reuse the
-- existing function definition and make only those column references explicit.

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.mc_resolve_matchup(bigint, bigint, text)'::regprocedure)
    into function_definition;

  function_definition := replace(
    function_definition,
    'group by entry_id',
    'group by public.bracket_votes.entry_id'
  );

  execute function_definition;
end;
$$;

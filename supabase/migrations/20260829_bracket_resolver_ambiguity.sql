-- The existing resolver has a PL/pgSQL variable named entry_id and queries
-- columns with the same name. Prefer the query column without changing the
-- bracket tables or resolver flow.

alter function public.mc_resolve_matchup(bigint, bigint, text)
  set plpgsql.variable_conflict = 'use_column';

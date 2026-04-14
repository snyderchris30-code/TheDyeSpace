-- Move pg_net extension out of public schema to satisfy security linting.
-- Safe to run repeatedly and safe when pg_net is unavailable.

create schema if not exists extensions;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      alter extension pg_net set schema extensions;
    exception
      when others then
        raise notice 'Could not move pg_net extension to extensions schema: %', sqlerrm;
    end;
  else
    raise notice 'pg_net extension is not installed in this environment.';
  end if;
end;
$$;

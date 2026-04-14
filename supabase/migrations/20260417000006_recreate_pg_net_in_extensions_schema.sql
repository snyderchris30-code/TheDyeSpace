-- pg_net is non-relocatable via ALTER EXTENSION SET SCHEMA.
-- Recreate it in the extensions schema when currently installed in public.

create schema if not exists extensions;

do $$
declare
  current_schema text;
begin
  select n.nspname
  into current_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_net';

  if current_schema is null then
    raise notice 'pg_net extension is not installed in this environment.';
    return;
  end if;

  if current_schema = 'extensions' then
    raise notice 'pg_net extension is already installed in extensions schema.';
    return;
  end if;

  if current_schema = 'public' then
    drop extension pg_net;
    create extension pg_net with schema extensions;
    raise notice 'Recreated pg_net extension in extensions schema.';
    return;
  end if;

  raise notice 'pg_net extension is installed in schema %, leaving unchanged.', current_schema;
exception
  when others then
    raise notice 'Could not recreate pg_net extension in extensions schema: %', sqlerrm;
end;
$$;

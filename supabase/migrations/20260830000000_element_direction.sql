-- Element Direction — "方針と受け入れ条件" as a first-class Element field.
-- Stores { approach, acceptance, next } as jsonb; shape is normalized on the
-- client via normalizeDirection (types/database.ts).
--
-- Wrapped in the same "skip on preview replay" guard as the elements.progress
-- migration: if public.elements hasn't been created yet (fresh preview
-- branch replaying the migrations folder), this becomes a no-op.

do $$
begin
  if to_regclass('public.elements') is null then
    raise notice 'elements.direction migration skipped: elements not present';
    return;
  end if;

  execute 'alter table public.elements add column if not exists direction jsonb';

  if not exists (
    select 1 from pg_constraint
    where conname = 'elements_direction_is_object'
      and conrelid = 'public.elements'::regclass
  ) then
    execute 'alter table public.elements add constraint elements_direction_is_object
             check (direction is null or jsonb_typeof(direction) = ''object'')';
  end if;
end
$$;

-- Element and Object types carry an icon: a Domain remembers one per type
-- name, beside the names themselves (domains.element_types / object_types).
-- A name with no entry shows the concept's own mark.
do $$
begin
  if to_regclass('public.domains') is null then
    raise notice 'type icons skipped: domains not present'; return;
  end if;
  alter table public.domains add column if not exists element_type_icons jsonb not null default '{}'::jsonb;
  alter table public.domains add column if not exists object_type_icons jsonb not null default '{}'::jsonb;
end $$;

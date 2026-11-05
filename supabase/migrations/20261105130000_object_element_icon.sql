-- Objects and Elements carry an icon of their own, as Strategies already do.
-- The value is 'glyph:<Name>' (Alcon's drawings), 'lucide:<kebab-name>'
-- (the standard set) or an emoji; null shows the concept's default icon.
-- `color` already exists on both tables and holds a palette key or a hex.
do $$
begin
  if to_regclass('public.objects') is null then
    raise notice 'objects.icon skipped: objects not present'; return;
  end if;
  execute 'alter table public.objects add column if not exists icon text';
end $$;

do $$
begin
  if to_regclass('public.elements') is null then
    raise notice 'elements.icon skipped: elements not present'; return;
  end if;
  execute 'alter table public.elements add column if not exists icon text';
end $$;

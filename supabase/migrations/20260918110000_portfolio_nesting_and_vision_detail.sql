-- Portfolios nest (parent_id); the Vision carries a horizon, a narrative and
-- success conditions beside its statement. Guarded for preview replay.
do $$
begin
  if to_regclass('public.portfolios') is not null and not exists (
    select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'portfolios' and column_name = 'parent_id') then
    alter table public.portfolios add column parent_id uuid references public.portfolios(id) on delete cascade;
    create index if not exists portfolios_parent_idx on public.portfolios (parent_id);
  end if;
  if to_regclass('public.activity_spaces') is null then return; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'activity_spaces' and column_name = 'vision_horizon') then
    alter table public.activity_spaces add column vision_horizon date;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'activity_spaces' and column_name = 'vision_narrative') then
    alter table public.activity_spaces add column vision_narrative text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'activity_spaces' and column_name = 'vision_conditions') then
    alter table public.activity_spaces add column vision_conditions jsonb not null default '[]'::jsonb;
  end if;
end
$$;

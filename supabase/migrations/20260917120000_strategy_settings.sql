-- Strategy settings (Settings > Strategy, and the Initiatives row's "…").
-- Timeline display is personal: five typed user_preferences columns.
-- Phase creation defaults are per Domain (Phases are Domain-scoped):
-- domains.phase_defaults jsonb {"length_days": n, "start": "today" | "after_last"},
-- every key optional, absent = no seeding. Guarded for preview replay.
do $$
begin
  if to_regclass('public.user_preferences') is null then
    raise notice 'strategy_settings migration skipped: user_preferences not present';
  else
    execute 'alter table public.user_preferences add column if not exists timeline_scale text not null default ''month''';
    execute 'alter table public.user_preferences drop constraint if exists user_preferences_timeline_scale_check';
    execute 'alter table public.user_preferences add constraint user_preferences_timeline_scale_check check (timeline_scale in (''month'', ''quarter''))';
    execute 'alter table public.user_preferences add column if not exists timeline_months_back integer not null default 2';
    execute 'alter table public.user_preferences drop constraint if exists user_preferences_timeline_months_back_check';
    execute 'alter table public.user_preferences add constraint user_preferences_timeline_months_back_check check (timeline_months_back between 0 and 12)';
    execute 'alter table public.user_preferences add column if not exists timeline_months_ahead integer not null default 10';
    execute 'alter table public.user_preferences drop constraint if exists user_preferences_timeline_months_ahead_check';
    execute 'alter table public.user_preferences add constraint user_preferences_timeline_months_ahead_check check (timeline_months_ahead between 3 and 36)';
    execute 'alter table public.user_preferences add column if not exists timeline_today_marker boolean not null default true';
    execute 'alter table public.user_preferences add column if not exists timeline_progress_fill boolean not null default true';
  end if;
  if to_regclass('public.domains') is null then
    raise notice 'strategy_settings migration skipped: domains not present';
  else
    execute 'alter table public.domains add column if not exists phase_defaults jsonb not null default ''{}''::jsonb';
  end if;
end
$$;

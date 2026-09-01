-- Personal Preferences (Settings > Personal > Preferences > General).
-- One row per user, owner_user-scoped like custom_columns.owner_user_id —
-- see web/src/alcon/settings/SettingsView.tsx PreferencesPanel, which was
-- previously UI-only local state (lost on reload).
create table if not exists public.user_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  home_view text not null default 'My Elements'
    constraint user_preferences_home_view_check
    check (home_view in ('My Elements', 'Inbox', 'Calendar')),
  display_names text not null default 'Full name'
    constraint user_preferences_display_names_check
    check (display_names in ('Full name', 'Short name', 'Username')),
  first_day_of_week text not null default 'Monday'
    constraint user_preferences_first_day_of_week_check
    check (first_day_of_week in ('Monday', 'Sunday', 'Saturday')),
  convert_emoticons boolean not null default true,
  send_comment_shortcut text not null default '⌘+Enter'
    constraint user_preferences_send_comment_shortcut_check
    check (send_comment_shortcut in ('⌘+Enter', 'Enter')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy user_preferences_owner on public.user_preferences
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Self-contained trigger (not the dashboard-managed public.update_updated_at_column,
-- which lives outside supabase/migrations/ and would be missing on a PR preview
-- branch's empty-DB replay).
create or replace function public.touch_user_preferences_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_preferences_touch_updated_at on public.user_preferences;
create trigger user_preferences_touch_updated_at
  before update on public.user_preferences
  for each row
  execute function public.touch_user_preferences_updated_at();

-- Settings > Personal > Notifications (el_QLT-020). Notifications are
-- created from two different places today — DB triggers on
-- element_comments/strategy_comments (notify_element_comment,
-- notify_strategy_comment) and direct client-side inserts (mention,
-- assigned, status_change, approval_decided; see ElementCommentsPanel.tsx,
-- ElementDetailView.tsx, ElementApprovalMenu.tsx) — and more call sites are
-- likely as approval_requested/due_soon get implemented. Rather than teach
-- every one of those call sites about a user's mute preferences, gate the
-- one place all of them already funnel through: INSERT on `notifications`
-- itself. A user who has muted a kind never gets a row created for it,
-- regardless of which path tried to create it.
--
-- A row present in notification_preferences means "muted" — absence means
-- enabled, so a user who has never opened this settings page gets every
-- kind by default (opt-out, not opt-in; nothing here changes existing
-- behavior until someone explicitly mutes something).
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and `notifications` lives outside the migrations folder
-- (base schema).

do $migration$
begin
  if to_regclass('public.notifications') is null then
    raise notice 'notification_preferences skipped: notifications table not present';
    return;
  end if;

  execute $sql$
    create table if not exists public.notification_preferences (
      user_id uuid not null references auth.users(id) on delete cascade,
      kind text not null,
      created_at timestamptz not null default now(),
      primary key (user_id, kind)
    )
  $sql$;

  execute 'alter table public.notification_preferences enable row level security';

  execute 'drop policy if exists notification_preferences_owner on public.notification_preferences';
  execute $sql$
    create policy notification_preferences_owner on public.notification_preferences
      for all
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid())
  $sql$;

  execute $sql$
    create or replace function public.filter_muted_notification()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, pg_catalog
    as $fn$
    begin
      if exists (
        select 1 from public.notification_preferences
        where user_id = new.recipient_id and kind = new.kind
      ) then
        return null; -- muted: silently skip this row, nothing else changes
      end if;
      return new;
    end;
    $fn$;
  $sql$;

  execute 'drop trigger if exists trg_filter_muted_notification on public.notifications';
  execute $sql$
    create trigger trg_filter_muted_notification
      before insert on public.notifications
      for each row
      execute function public.filter_muted_notification()
  $sql$;
end
$migration$;

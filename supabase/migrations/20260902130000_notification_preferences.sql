-- Settings > Personal > Notifications (el_QLT-020). Notifications are
-- created from several different places today — DB triggers on
-- element_comments/strategy_comments (notify_element_comment,
-- notify_strategy_comment), direct client-side inserts (mention, assigned,
-- status_change, approval_decided; see ElementCommentsPanel.tsx,
-- ElementDetailView.tsx, ElementApprovalMenu.tsx), and Edge Functions
-- (run-agent reports its own outcome under 'status_change' too) — and more
-- call sites are likely as approval_requested/due_soon get implemented.
-- Rather than teach every one of those call sites about a user's mute
-- preferences, gate the one place all of them already funnel through:
-- INSERT on `notifications` itself. A user who has muted a kind never gets
-- a row created for it, regardless of which path tried to create it.
--
-- A row present in notification_preferences means "muted" — absence means
-- enabled, so a user who has never opened this settings page gets every
-- kind by default (opt-out, not opt-in; nothing here changes existing
-- behavior until someone explicitly mutes something).
--
-- `notification_preferences` itself only depends on auth.users (always
-- present), so its creation isn't gated on `notifications` existing — only
-- the trigger that reads `notifications.recipient_id`/`kind` needs that
-- table to exist first. Splitting the guards this way means Settings >
-- Notifications still has a real table to read/write on a preview branch
-- (empty DB, `notifications` lives in the base schema outside this folder)
-- even though the mute enforcement itself is a no-op there.

do $migration$
begin
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

  if to_regclass('public.notifications') is null then
    raise notice 'notification mute trigger skipped: notifications table not present';
    return;
  end if;

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

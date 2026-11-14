-- Notifications by email, chosen per kind in Settings > Notifications.
--
-- notification_email_preferences: one row per (person, kind) the person has
-- chosen for. Without a row, the default holds: what is addressed to the
-- person — being assigned or made Lead, being mentioned, a comment on their
-- work — is emailed; every other kind is not (notification_email_default).
--
-- notification_emails is the outbox. A notification that survives the mute
-- filter (the BEFORE INSERT trigger drops muted kinds, so a muted kind is
-- never emailed either) and whose kind the recipient wants by email queues
-- one row here. The every-minute automations tick sends the queue through
-- the mail provider (supabase/functions/_shared/notificationEmail.ts) and
-- marks each row sent or failed. Nobody reads the outbox from the app.

do $migration$
begin
  execute $sql$
    create table if not exists public.notification_email_preferences (
      user_id uuid not null references auth.users(id) on delete cascade,
      kind text not null,
      enabled boolean not null,
      updated_at timestamptz not null default now(),
      primary key (user_id, kind)
    )
  $sql$;
  execute 'alter table public.notification_email_preferences enable row level security';
  execute 'drop policy if exists notification_email_preferences_owner on public.notification_email_preferences';
  execute $sql$
    create policy notification_email_preferences_owner on public.notification_email_preferences
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid())
  $sql$;

  execute $sql$
    create or replace function public.notification_email_default(p_kind text)
    returns boolean language sql immutable set search_path = '' as $fn$
      select p_kind in ('assigned', 'mention', 'comment')
    $fn$
  $sql$;

  if to_regclass('public.notifications') is null then
    raise notice 'notification emails: notifications table not present, outbox skipped';
    return;
  end if;

  execute $sql$
    create table if not exists public.notification_emails (
      id uuid primary key default gen_random_uuid(),
      notification_id uuid not null unique references public.notifications(id) on delete cascade,
      recipient_id uuid not null references auth.users(id) on delete cascade,
      status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
      attempts int not null default 0,
      last_error text,
      created_at timestamptz not null default now(),
      claimed_at timestamptz,
      sent_at timestamptz
    )
  $sql$;
  execute 'create index if not exists notification_emails_pending_idx on public.notification_emails (created_at) where status = ''pending''';
  execute 'alter table public.notification_emails enable row level security';
  execute 'revoke all on table public.notification_emails from public, anon, authenticated';

  execute $sql$
    create or replace function public.queue_notification_email()
    returns trigger language plpgsql security definer set search_path = public, pg_catalog as $fn$
    declare
      v_wants boolean;
    begin
      select p.enabled into v_wants from notification_email_preferences p
        where p.user_id = new.recipient_id and p.kind = new.kind;
      if coalesce(v_wants, notification_email_default(new.kind)) then
        insert into notification_emails (notification_id, recipient_id)
          values (new.id, new.recipient_id)
          on conflict (notification_id) do nothing;
      end if;
      return new;
    end
    $fn$
  $sql$;
  execute 'revoke all on function public.queue_notification_email() from public, anon, authenticated';

  execute 'drop trigger if exists trg_queue_notification_email on public.notifications';
  execute $sql$
    create trigger trg_queue_notification_email
      after insert on public.notifications
      for each row execute function public.queue_notification_email()
  $sql$;

  -- The tick claims a batch atomically, so two overlapping ticks never send
  -- the same email twice. A row stuck in 'sending' (the tick died mid-send)
  -- goes back to the queue after ten minutes.
  execute $sql$
    create or replace function public.claim_notification_emails(p_limit int)
    returns setof public.notification_emails
    language sql security definer set search_path = public, pg_catalog as $fn$
      update notification_emails e set status = 'sending', attempts = e.attempts + 1, claimed_at = now()
      where e.id in (
        select id from notification_emails
        where (status = 'pending' or (status = 'sending' and claimed_at < now() - interval '10 minutes'))
          and attempts < 3
        order by created_at
        limit p_limit
        for update skip locked
      )
      returning e.*
    $fn$
  $sql$;
  execute 'revoke all on function public.claim_notification_emails(int) from public, anon, authenticated';
  execute 'grant execute on function public.claim_notification_emails(int) to service_role';
end
$migration$;

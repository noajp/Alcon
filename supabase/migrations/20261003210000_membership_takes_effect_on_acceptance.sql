-- Membership takes effect once the invited person accepts (ELE_AI-102, ADR 0029).
--
-- Until now a Space owner, a Domain owner/admin or the owner/admin of an
-- Object's Domain wrote the other person's membership row directly, so
-- anyone could be made a member of any Space, Domain or Object without
-- consent — and with that membership came their Worker in that Space and an
-- owner's reach over its capacity, status and availability (ADR 0028). Two
-- more holes rode on the same INSERT policies:
--
--   dm insert self or owner / om insert self or domain-owner accepted
--   user_id = auth.uid() with any role on any id: anyone who knew a Domain's
--   or Object's UUID could insert themselves as its owner.
--   activity_space_members_update let an owner rewrite a row's user_id (or
--   Space), turning their own membership into somebody else's; the
--   creator branch of activity_space_members_insert let a Space's creator
--   re-add themselves as owner after being removed.
--
-- The membership tables keep meaning "active member", so every reader that
-- does not know about invitations fails closed. An invitation is a separate
-- row in public.membership_invitations, written only by invite_member, and
-- becomes a membership only through respond_to_invite by the invitee.
--
--   - Browsers insert membership rows only for themselves: the creator of a
--     Space / Domain / Object as its first member, or a person joining as
--     'member' a Domain or Object they can already see (Discover).
--   - No membership row can change person or scope (trigger).
--   - domain_members / object_members roles are owner / admin / member.
--   - invite_member notifies the invitee with kind 'invite'; joining by any
--     path settles that person's pending invitation to the same scope.
--
-- Every existing membership row was written by its own member (creators), so
-- no data changes: existing rows are the accepted state.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.activity_space_members') is null
     or to_regclass('public.domain_members') is null
     or to_regclass('public.object_members') is null
     or to_regclass('public.activity_spaces') is null
     or to_regclass('public.domains') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.user_is_domain_member(uuid)') is null
     or to_regprocedure('public.user_is_object_member(uuid)') is null then
    raise notice 'membership_takes_effect_on_acceptance skipped: base schema not present';
    return;
  end if;

  execute 'create schema if not exists alcon_internal';

  -- ── Invitations ─────────────────────────────────────────────────────────
  execute $t$
    create table if not exists public.membership_invitations (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid references public.activity_spaces(id) on delete cascade,
      domain_id uuid references public.domains(id) on delete cascade,
      object_id uuid references public.objects(id) on delete cascade,
      invitee_id uuid not null references auth.users(id) on delete cascade,
      invited_by uuid references auth.users(id) on delete set null,
      role text not null default 'member' check (role = 'member'),
      scope_name text not null,
      inviter_name text,
      status text not null default 'pending'
        check (status in ('pending', 'accepted', 'declined', 'canceled')),
      created_at timestamptz not null default now(),
      responded_at timestamptz,
      constraint membership_invitations_one_scope
        check (num_nonnulls(activity_space_id, domain_id, object_id) = 1)
    )
  $t$;
  execute 'create unique index if not exists membership_invitations_one_pending
    on public.membership_invitations (coalesce(activity_space_id, domain_id, object_id), invitee_id)
    where status = ''pending''';
  execute 'create index if not exists membership_invitations_invitee_idx
    on public.membership_invitations (invitee_id) where status = ''pending''';
  execute 'create index if not exists membership_invitations_space_idx
    on public.membership_invitations (activity_space_id) where activity_space_id is not null';
  execute 'create index if not exists membership_invitations_domain_idx
    on public.membership_invitations (domain_id) where domain_id is not null';
  execute 'create index if not exists membership_invitations_object_idx
    on public.membership_invitations (object_id) where object_id is not null';
  execute 'alter table public.membership_invitations enable row level security';
  execute 'revoke all on public.membership_invitations from public, anon, authenticated';
  execute 'grant select on public.membership_invitations to authenticated';

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = 'membership_invitations') then
    execute 'alter publication supabase_realtime add table public.membership_invitations';
  end if;

  -- ── Notifications carry the invitation ──────────────────────────────────
  execute 'alter table public.notifications add column if not exists invitation_id uuid
    references public.membership_invitations(id) on delete cascade';
  execute 'create index if not exists notifications_invitation_idx
    on public.notifications (invitation_id) where invitation_id is not null';
  execute 'alter table public.notifications drop constraint if exists notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array[
    ''mention'', ''assigned'', ''comment'', ''status_change'', ''approval_requested'',
    ''approval_decided'', ''due_soon'', ''review_due'', ''invite''
  ]::text[]))';

  -- ── Helpers ─────────────────────────────────────────────────────────────
  -- Whether a scope already has a member: the creator's self-join is only the
  -- first row. SECURITY DEFINER so it counts rows the caller cannot read.
  execute $f$
    create or replace function alcon_internal.space_has_members(p_space uuid)
    returns boolean language sql stable security definer set search_path = ''
    as $b$ select exists (select 1 from public.activity_space_members where activity_space_id = p_space) $b$
  $f$;
  execute $f$
    create or replace function alcon_internal.domain_has_members(p_domain uuid)
    returns boolean language sql stable security definer set search_path = ''
    as $b$ select exists (select 1 from public.domain_members where domain_id = p_domain) $b$
  $f$;
  execute $f$
    create or replace function alcon_internal.object_has_members(p_object uuid)
    returns boolean language sql stable security definer set search_path = ''
    as $b$ select exists (select 1 from public.object_members where object_id = p_object) $b$
  $f$;

  -- Who may invite to (and cancel invitations of) a scope, for a given
  -- person: a Space owner; a Domain owner or admin; an owner or admin of the
  -- Object's Domain.
  execute $f$
    create or replace function alcon_internal.user_manages_scope_as(p_user uuid, p_scope text, p_scope_id uuid)
    returns boolean language sql stable security definer set search_path = ''
    as $b$
      select p_user is not null and p_scope_id is not null and case p_scope
        when 'space' then exists (
          select 1 from public.activity_space_members m
           where m.activity_space_id = p_scope_id and m.user_id = p_user and m.role = 'owner')
        when 'domain' then exists (
          select 1 from public.domain_members dm
           where dm.domain_id = p_scope_id and dm.user_id = p_user and dm.role in ('owner', 'admin'))
        when 'object' then exists (
          select 1 from public.objects o
            join public.domain_members dm on dm.domain_id = o.domain_id
           where o.id = p_scope_id and dm.user_id = p_user and dm.role in ('owner', 'admin'))
        else false
      end
    $b$
  $f$;

  -- Who may read an invitation: the invitee, its inviter, the people who
  -- manage the scope, and the scope's members (member lists show "Invited").
  execute $f$
    create or replace function alcon_internal.user_can_see_invitation(
      p_space uuid, p_domain uuid, p_object uuid, p_invitee uuid, p_inviter uuid)
    returns boolean language sql stable security definer set search_path = ''
    as $b$
      select auth.uid() is not null and (
        p_invitee = auth.uid()
        or p_inviter = auth.uid()
        or (p_space is not null and public.is_activity_space_member(p_space))
        or (p_domain is not null and public.user_is_domain_member(p_domain))
        or (p_object is not null and (public.user_is_object_member(p_object)
            or alcon_internal.user_manages_scope_as(auth.uid(), 'object', p_object))))
    $b$
  $f$;

  execute 'revoke all on function alcon_internal.space_has_members(uuid) from public, anon';
  execute 'revoke all on function alcon_internal.domain_has_members(uuid) from public, anon';
  execute 'revoke all on function alcon_internal.object_has_members(uuid) from public, anon';
  execute 'revoke all on function alcon_internal.user_manages_scope_as(uuid, text, uuid) from public, anon';
  execute 'revoke all on function alcon_internal.user_can_see_invitation(uuid, uuid, uuid, uuid, uuid) from public, anon';
  execute 'grant execute on function alcon_internal.space_has_members(uuid) to authenticated';
  execute 'grant execute on function alcon_internal.domain_has_members(uuid) to authenticated';
  execute 'grant execute on function alcon_internal.object_has_members(uuid) to authenticated';
  execute 'grant execute on function alcon_internal.user_manages_scope_as(uuid, text, uuid) to authenticated';
  execute 'grant execute on function alcon_internal.user_can_see_invitation(uuid, uuid, uuid, uuid, uuid) to authenticated';
  execute 'grant usage on schema alcon_internal to authenticated';

  execute 'drop policy if exists membership_invitations_select on public.membership_invitations';
  execute 'create policy membership_invitations_select on public.membership_invitations
    for select to authenticated
    using (alcon_internal.user_can_see_invitation(activity_space_id, domain_id, object_id, invitee_id, invited_by))';

  -- ── Membership rows: only yourself, only as described ───────────────────
  execute 'drop policy if exists activity_space_members_insert on public.activity_space_members';
  execute 'create policy activity_space_members_insert on public.activity_space_members
    for insert to authenticated
    with check (
      user_id = auth.uid()
      and role = ''owner''
      and exists (select 1 from public.activity_spaces s
                   where s.id = activity_space_members.activity_space_id and s.created_by = auth.uid())
      and not alcon_internal.space_has_members(activity_space_members.activity_space_id)
    )';

  execute 'drop policy if exists "dm insert self or owner" on public.domain_members';
  execute 'drop policy if exists "dm insert self" on public.domain_members';
  execute 'create policy "dm insert self" on public.domain_members
    for insert to authenticated
    with check (
      user_id = auth.uid()
      and (
        (exists (select 1 from public.domains d
                  where d.id = domain_members.domain_id and d.user_id = auth.uid())
         and not alcon_internal.domain_has_members(domain_members.domain_id))
        or (role = ''member'' and public.user_can_see_domain(domain_members.domain_id))
      )
    )';

  execute 'drop policy if exists "om insert self or domain-owner" on public.object_members';
  execute 'drop policy if exists "om insert self" on public.object_members';
  execute 'create policy "om insert self" on public.object_members
    for insert to authenticated
    with check (
      user_id = auth.uid()
      and (
        (exists (select 1 from public.objects o
                  where o.id = object_members.object_id and o.user_id = auth.uid())
         and not alcon_internal.object_has_members(object_members.object_id))
        or (role = ''member'' and public.user_can_see_object(object_members.object_id))
      )
    )';

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.domain_members'::regclass and conname = 'domain_members_role_check') then
    execute 'alter table public.domain_members add constraint domain_members_role_check
      check (role in (''owner'', ''admin'', ''member''))';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.object_members'::regclass and conname = 'object_members_role_check') then
    execute 'alter table public.object_members add constraint object_members_role_check
      check (role in (''owner'', ''admin'', ''member''))';
  end if;

  -- A membership never changes person or scope; only its role can change.
  execute $f$
    create or replace function alcon_internal.membership_keys_are_fixed()
    returns trigger language plpgsql set search_path = ''
    as $b$
    begin
      if new.user_id is distinct from old.user_id
         or (to_jsonb(new) ->> tg_argv[0]) is distinct from (to_jsonb(old) ->> tg_argv[0]) then
        raise exception 'A membership cannot move to another person or scope'
          using errcode = '42501';
      end if;
      return new;
    end
    $b$
  $f$;
  execute 'drop trigger if exists activity_space_members_keys_fixed on public.activity_space_members';
  execute 'create trigger activity_space_members_keys_fixed before update on public.activity_space_members
    for each row execute function alcon_internal.membership_keys_are_fixed(''activity_space_id'')';
  execute 'drop trigger if exists domain_members_keys_fixed on public.domain_members';
  execute 'create trigger domain_members_keys_fixed before update on public.domain_members
    for each row execute function alcon_internal.membership_keys_are_fixed(''domain_id'')';
  execute 'drop trigger if exists object_members_keys_fixed on public.object_members';
  execute 'create trigger object_members_keys_fixed before update on public.object_members
    for each row execute function alcon_internal.membership_keys_are_fixed(''object_id'')';

  -- Joining by any path (accepting, or Discover on a visible Domain/Object)
  -- settles that person's pending invitation to the same scope.
  execute $f$
    create or replace function alcon_internal.settle_invitations_on_join()
    returns trigger language plpgsql security definer set search_path = ''
    as $b$
    declare
      v_scope uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
      v_ids uuid[];
    begin
      execute format(
        'with settled as (
           update public.membership_invitations set status = ''accepted'', responded_at = now()
            where status = ''pending'' and invitee_id = $1 and %I = $2
           returning id)
         select coalesce(array_agg(id), ''{}'') from settled', tg_argv[0])
        into v_ids
        using new.user_id, v_scope;
      if cardinality(v_ids) > 0 then
        update public.notifications set is_read = true
         where invitation_id = any (v_ids) and recipient_id = new.user_id;
      end if;
      return new;
    end
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.settle_invitations_on_join() from public, anon, authenticated';
  execute 'drop trigger if exists activity_space_members_settle_invitations on public.activity_space_members';
  execute 'create trigger activity_space_members_settle_invitations after insert on public.activity_space_members
    for each row execute function alcon_internal.settle_invitations_on_join(''activity_space_id'')';
  execute 'drop trigger if exists domain_members_settle_invitations on public.domain_members';
  execute 'create trigger domain_members_settle_invitations after insert on public.domain_members
    for each row execute function alcon_internal.settle_invitations_on_join(''domain_id'')';
  execute 'drop trigger if exists object_members_settle_invitations on public.object_members';
  execute 'create trigger object_members_settle_invitations after insert on public.object_members
    for each row execute function alcon_internal.settle_invitations_on_join(''object_id'')';

  -- ── RPCs ────────────────────────────────────────────────────────────────
  execute $f$
    create or replace function public.invite_member(p_scope text, p_scope_id uuid, p_user uuid)
    returns uuid
    language plpgsql
    volatile
    security definer
    set search_path = ''
    as $b$
    declare
      v_actor uuid := auth.uid();
      v_scope_name text;
      v_inviter_name text;
      v_is_member boolean;
      v_label text;
      v_id uuid;
    begin
      if v_actor is null then
        raise exception 'Sign in to invite people' using errcode = '42501';
      end if;
      if p_scope is null or p_scope not in ('space', 'domain', 'object') or p_scope_id is null or p_user is null then
        raise exception 'Choose a Space, Domain or Object and a person to invite' using errcode = '22023';
      end if;
      if p_user = v_actor then
        raise exception 'You cannot invite yourself' using errcode = '22023';
      end if;
      if not alcon_internal.user_manages_scope_as(v_actor, p_scope, p_scope_id) then
        raise exception 'Only people who manage this % can invite to it', p_scope using errcode = '42501';
      end if;
      if not exists (select 1 from auth.users where id = p_user) then
        raise exception 'That person has no account' using errcode = '22023';
      end if;

      if p_scope = 'space' then
        select s.name into v_scope_name from public.activity_spaces s where s.id = p_scope_id;
        select exists (select 1 from public.activity_space_members
                        where activity_space_id = p_scope_id and user_id = p_user) into v_is_member;
        v_label := 'Space';
      elsif p_scope = 'domain' then
        select d.name into v_scope_name from public.domains d where d.id = p_scope_id;
        select exists (select 1 from public.domain_members
                        where domain_id = p_scope_id and user_id = p_user) into v_is_member;
        v_label := 'Domain';
      else
        select o.name into v_scope_name from public.objects o where o.id = p_scope_id;
        select exists (select 1 from public.object_members
                        where object_id = p_scope_id and user_id = p_user) into v_is_member;
        v_label := 'Object';
      end if;
      if v_is_member then
        raise exception 'This person is already a member' using errcode = '23505';
      end if;
      if exists (select 1 from public.membership_invitations
                  where status = 'pending' and invitee_id = p_user
                    and coalesce(activity_space_id, domain_id, object_id) = p_scope_id) then
        raise exception 'This person already has a pending invitation' using errcode = '23505';
      end if;

      select nullif(btrim(p.display_name), '') into v_inviter_name from public.profiles p where p.id = v_actor;

      insert into public.membership_invitations
        (activity_space_id, domain_id, object_id, invitee_id, invited_by, scope_name, inviter_name)
      values (
        case when p_scope = 'space' then p_scope_id end,
        case when p_scope = 'domain' then p_scope_id end,
        case when p_scope = 'object' then p_scope_id end,
        p_user, v_actor, coalesce(v_scope_name, ''), v_inviter_name)
      returning id into v_id;

      insert into public.notifications (recipient_id, actor_id, actor_name, kind, invitation_id, title, body)
      values (
        p_user, v_actor, v_inviter_name, 'invite', v_id,
        coalesce(v_inviter_name, 'Someone') || ' invited you to ' || v_label || ' ' || coalesce(v_scope_name, ''),
        'You join when you accept. Until then you are not a member and nothing in it is shared with you.');

      return v_id;
    end
    $b$
  $f$;

  execute $f$
    create or replace function public.respond_to_invite(p_invitation uuid, p_accept boolean)
    returns text
    language plpgsql
    volatile
    security definer
    set search_path = ''
    as $b$
    declare
      v public.membership_invitations%rowtype;
      v_scope text;
      v_scope_id uuid;
      v_status text;
    begin
      if auth.uid() is null then
        raise exception 'Sign in to answer an invitation' using errcode = '42501';
      end if;
      select * into v from public.membership_invitations where id = p_invitation for update;
      if not found or v.invitee_id <> auth.uid() then
        raise exception 'Invitation not found' using errcode = 'P0002';
      end if;
      if v.status <> 'pending' then
        return v.status;
      end if;

      v_scope := case when v.activity_space_id is not null then 'space'
                      when v.domain_id is not null then 'domain' else 'object' end;
      v_scope_id := coalesce(v.activity_space_id, v.domain_id, v.object_id);

      if not coalesce(p_accept, false) then
        v_status := 'declined';
      elsif not alcon_internal.user_manages_scope_as(v.invited_by, v_scope, v_scope_id) then
        -- The inviter no longer manages this scope: the invitation lapsed.
        v_status := 'canceled';
      else
        v_status := 'accepted';
      end if;

      update public.membership_invitations
         set status = v_status, responded_at = now()
       where id = v.id;

      if v_status = 'accepted' then
        if v_scope = 'space' then
          insert into public.activity_space_members (activity_space_id, user_id, role)
          values (v.activity_space_id, v.invitee_id, 'member') on conflict do nothing;
        elsif v_scope = 'domain' then
          insert into public.domain_members (domain_id, user_id, role)
          values (v.domain_id, v.invitee_id, 'member') on conflict do nothing;
        else
          insert into public.object_members (object_id, user_id, role)
          values (v.object_id, v.invitee_id, 'member') on conflict do nothing;
        end if;
      end if;

      update public.notifications set is_read = true
       where invitation_id = v.id and recipient_id = v.invitee_id;

      return v_status;
    end
    $b$
  $f$;

  execute $f$
    create or replace function public.cancel_invite(p_invitation uuid)
    returns void
    language plpgsql
    volatile
    security definer
    set search_path = ''
    as $b$
    declare
      v public.membership_invitations%rowtype;
      v_scope text;
    begin
      if auth.uid() is null then
        raise exception 'Sign in to cancel an invitation' using errcode = '42501';
      end if;
      select * into v from public.membership_invitations where id = p_invitation for update;
      if not found then
        raise exception 'Invitation not found' using errcode = 'P0002';
      end if;
      v_scope := case when v.activity_space_id is not null then 'space'
                      when v.domain_id is not null then 'domain' else 'object' end;
      if not (v.invited_by = auth.uid()
              or alcon_internal.user_manages_scope_as(auth.uid(), v_scope,
                   coalesce(v.activity_space_id, v.domain_id, v.object_id))) then
        raise exception 'Only the inviter or people who manage this % can cancel it', v_scope using errcode = '42501';
      end if;
      if v.status <> 'pending' then
        return;
      end if;
      update public.membership_invitations set status = 'canceled', responded_at = now() where id = v.id;
      delete from public.notifications where invitation_id = v.id;
    end
    $b$
  $f$;

  execute 'revoke all on function public.invite_member(text, uuid, uuid) from public, anon';
  execute 'revoke all on function public.respond_to_invite(uuid, boolean) from public, anon';
  execute 'revoke all on function public.cancel_invite(uuid) from public, anon';
  execute 'grant execute on function public.invite_member(text, uuid, uuid) to authenticated';
  execute 'grant execute on function public.respond_to_invite(uuid, boolean) to authenticated';
  execute 'grant execute on function public.cancel_invite(uuid) to authenticated';
end $$;

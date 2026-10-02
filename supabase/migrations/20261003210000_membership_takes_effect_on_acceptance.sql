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
--   - The creator's owner membership is written by the server: an AFTER
--     INSERT trigger on activity_spaces / domains / objects enrols auth.uid()
--     as owner. Browsers write no owner rows and no rows for other people;
--     the only browser INSERT left is joining, as 'member', a Domain or
--     Object they can already see (Discover). activity_space_members has no
--     browser INSERT at all.
--   - The creator columns (activity_spaces.created_by, domains.user_id,
--     objects.user_id) are stamped on insert and fixed afterwards, so no one
--     can make themselves the "creator" of something that already exists.
--   - No membership row can change person or scope (trigger), and a Domain or
--     Object keeps at least one owner, like a Space. An owner/admin of an
--     Object's Domain sees and removes its members without joining; removing
--     the last owner hands the ownership to them.
--   - domain_members / object_members roles are owner / admin / member.
--   - invite_member notifies the invitee with kind 'invite' and refuses to
--     invite again for 7 days after they declined; joining by any path
--     settles that person's pending invitation to the same scope.
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

  execute 'revoke all on function alcon_internal.user_manages_scope_as(uuid, text, uuid) from public, anon';
  execute 'revoke all on function alcon_internal.user_can_see_invitation(uuid, uuid, uuid, uuid, uuid) from public, anon';
  execute 'grant execute on function alcon_internal.user_manages_scope_as(uuid, text, uuid) to authenticated';
  execute 'grant execute on function alcon_internal.user_can_see_invitation(uuid, uuid, uuid, uuid, uuid) to authenticated';
  execute 'grant usage on schema alcon_internal to authenticated';

  execute 'drop policy if exists membership_invitations_select on public.membership_invitations';
  execute 'create policy membership_invitations_select on public.membership_invitations
    for select to authenticated
    using (alcon_internal.user_can_see_invitation(activity_space_id, domain_id, object_id, invitee_id, invited_by))';

  -- ── Creators are enrolled by the server ─────────────────────────────────
  -- The creator columns are the caller on insert and never change afterwards
  -- from a signed-in session (auth.uid() is set). Server jobs and the service
  -- role (auth.uid() null) are left alone.
  execute $f$
    create or replace function alcon_internal.objects_stamp_creator()
    returns trigger language plpgsql set search_path = ''
    as $b$
    begin
      if auth.uid() is not null then
        new.user_id := auth.uid();
      end if;
      return new;
    end
    $b$
  $f$;
  execute 'drop trigger if exists objects_stamp_creator on public.objects';
  execute 'create trigger objects_stamp_creator before insert on public.objects
    for each row execute function alcon_internal.objects_stamp_creator()';

  execute $f$
    create or replace function alcon_internal.creator_is_fixed()
    returns trigger language plpgsql set search_path = ''
    as $b$
    begin
      if auth.uid() is not null
         and (to_jsonb(new) ->> tg_argv[0]) is distinct from (to_jsonb(old) ->> tg_argv[0]) then
        raise exception 'The creator of a % cannot be changed', tg_argv[1] using errcode = '42501';
      end if;
      return new;
    end
    $b$
  $f$;
  execute 'drop trigger if exists activity_spaces_creator_fixed on public.activity_spaces';
  execute 'create trigger activity_spaces_creator_fixed before update on public.activity_spaces
    for each row execute function alcon_internal.creator_is_fixed(''created_by'', ''Space'')';
  execute 'drop trigger if exists domains_creator_fixed on public.domains';
  execute 'create trigger domains_creator_fixed before update on public.domains
    for each row execute function alcon_internal.creator_is_fixed(''user_id'', ''Domain'')';
  execute 'drop trigger if exists objects_creator_fixed on public.objects';
  execute 'create trigger objects_creator_fixed before update on public.objects
    for each row execute function alcon_internal.creator_is_fixed(''user_id'', ''Object'')';

  -- Whoever creates a Space, Domain or Object is its first owner, written in
  -- the same statement — the browser never writes an owner row.
  execute $f$
    create or replace function alcon_internal.enrol_creator_as_owner()
    returns trigger language plpgsql security definer set search_path = ''
    as $b$
    begin
      if auth.uid() is null then
        return new;
      end if;
      if tg_table_name = 'activity_spaces' then
        insert into public.activity_space_members (activity_space_id, user_id, role)
        values (new.id, auth.uid(), 'owner') on conflict do nothing;
      elsif tg_table_name = 'domains' then
        insert into public.domain_members (domain_id, user_id, role)
        values (new.id, auth.uid(), 'owner') on conflict do nothing;
      else
        insert into public.object_members (object_id, user_id, role)
        values (new.id, auth.uid(), 'owner') on conflict do nothing;
      end if;
      return new;
    end
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.enrol_creator_as_owner() from public, anon, authenticated';
  execute 'drop trigger if exists activity_spaces_enrol_creator on public.activity_spaces';
  execute 'create trigger activity_spaces_enrol_creator after insert on public.activity_spaces
    for each row execute function alcon_internal.enrol_creator_as_owner()';
  execute 'drop trigger if exists domains_enrol_creator on public.domains';
  execute 'create trigger domains_enrol_creator after insert on public.domains
    for each row execute function alcon_internal.enrol_creator_as_owner()';
  execute 'drop trigger if exists objects_enrol_creator on public.objects';
  execute 'create trigger objects_enrol_creator after insert on public.objects
    for each row execute function alcon_internal.enrol_creator_as_owner()';

  -- ── Membership rows from browsers: joining a visible scope as member ────
  execute 'drop policy if exists activity_space_members_insert on public.activity_space_members';

  execute 'drop policy if exists "dm insert self or owner" on public.domain_members';
  execute 'drop policy if exists "dm insert self" on public.domain_members';
  execute 'create policy "dm insert self" on public.domain_members
    for insert to authenticated
    with check (
      user_id = auth.uid()
      and role = ''member''
      and public.user_can_see_domain(domain_members.domain_id)
    )';

  execute 'drop policy if exists "om insert self or domain-owner" on public.object_members';
  execute 'drop policy if exists "om insert self" on public.object_members';
  execute 'create policy "om insert self" on public.object_members
    for insert to authenticated
    with check (
      user_id = auth.uid()
      and role = ''member''
      and public.user_can_see_object(object_members.object_id)
    )';

  -- import_existing_work wrote the creator's owner rows itself; the triggers
  -- above do that now, and the browser policy no longer admits an owner row.
  -- Same body as 20261003160000_workers_rls_and_notify_recipients.sql minus
  -- those two inserts; signature, invoker security and search_path unchanged
  -- (create or replace keeps the grants).
  if to_regprocedure('public.import_existing_work(uuid, uuid, uuid, uuid, text, jsonb)') is not null
     and to_regclass('public.work_import_receipts') is not null
     and to_regclass('public.element_objects') is not null
     and to_regprocedure('alcon_internal.work_import_object_in_space(uuid, uuid)') is not null then
    execute $f$
      create or replace function public.import_existing_work(p_space_id uuid, p_batch_id uuid, p_object_id uuid, p_domain_id uuid, p_project_name text, p_rows jsonb)
      returns jsonb language plpgsql set search_path = '' as $b$
      declare
        v_user uuid := auth.uid();
        v_request jsonb;
        v_receipt public.work_import_receipts%rowtype;
        v_object uuid := p_object_id;
        v_domain uuid := p_domain_id;
        v_row jsonb;
        v_id uuid;
        v_worker uuid;
        v_date date;
        v_description text;
        v_source jsonb;
        v_result jsonb := '[]'::jsonb;
        v_count integer;
      begin
        if v_user is null or p_batch_id is null or p_space_id is null or not public.is_activity_space_member(p_space_id) then
          raise exception 'An authenticated Space member is required' using errcode = '42501';
        end if;
        if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Import rows must be an array'; end if;
        v_count := jsonb_array_length(p_rows);
        if v_count < 1 or v_count > 100 or octet_length(p_rows::text) > 1048576 then
          raise exception 'Import 1 to 100 Elements, up to 1 MB, at a time';
        end if;
        if (select count(distinct r->>'rowKey') from jsonb_array_elements(p_rows) r) <> v_count then
          raise exception 'Every import row must have a unique key';
        end if;
        v_request := jsonb_build_object('space',p_space_id,'object',p_object_id,'domain',p_domain_id,
          'name',p_project_name,'rows',p_rows);
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_batch_id::text, 0));
        select * into v_receipt from public.work_import_receipts where id = p_batch_id;
        if found then
          if v_receipt.outcome='abandoned' then
            raise exception 'This import was closed before any work was saved. Start a new import.' using errcode='P2001';
          end if;
          if v_receipt.created_by <> v_user or v_receipt.request <> v_request then
            raise exception 'This import was already used with different contents';
          end if;
          if not alcon_internal.work_import_object_in_space(v_receipt.object_id,p_space_id) or exists (
            select 1 from jsonb_array_elements(v_receipt.result) r
            where not exists (select 1 from public.elements e
              where e.id = (r->>'elementId')::uuid and e.object_id = v_receipt.object_id)
          ) then raise exception 'Imported work has been removed or is no longer visible. Open the project to check it.' using errcode='P2002'; end if;
          return jsonb_build_object('saved',v_receipt.result,'objectId',v_receipt.object_id,'replayed',true);
        end if;

        if v_object is not null then
          if not alcon_internal.work_import_object_in_space(v_object,p_space_id) then
            raise exception 'Choose a visible project in this Space' using errcode = '42501';
          end if;
        else
          if nullif(btrim(p_project_name),'') is null or length(p_project_name) > 160 then
            raise exception 'Give this project a name of up to 160 characters';
          end if;
          if v_domain is not null then
            perform 1 from public.domains d where d.id=v_domain and d.activity_space_id=p_space_id and public.user_can_see_domain(d.id);
            if not found then raise exception 'Choose a visible Domain in this Space' using errcode = '42501'; end if;
          else
            -- The first real project creates its storage container. Users need
            -- not learn the Domain/Object taxonomy before bringing their work.
            -- domains_enrol_creator makes the caller its owner.
            insert into public.domains(name,user_id,activity_space_id,privacy)
              values ('General',v_user,p_space_id,'workspace') returning id into v_domain;
          end if;
          -- objects_enrol_creator makes the caller the project's owner.
          insert into public.objects(name,domain_id,user_id) values(btrim(p_project_name),v_domain,v_user) returning id into v_object;
          -- The primary FK already establishes this home. Its duplicate junction
          -- is writable only by the Domain creator under the existing policy.
          if exists(select 1 from public.domains d where d.id=v_domain and d.user_id=v_user) then
            insert into public.object_domains(object_id,domain_id) values(v_object,v_domain) on conflict do nothing;
          end if;
        end if;

        for v_row in select value from jsonb_array_elements(p_rows) loop
          if jsonb_typeof(v_row) <> 'object' or nullif(btrim(v_row->>'rowKey'),'') is null
            or length(v_row->>'rowKey') > 120 or nullif(btrim(v_row->>'title'),'') is null
            or jsonb_typeof(v_row->'title') <> 'string' or jsonb_typeof(v_row->'rowKey') <> 'string'
            or length(v_row->>'title') > 500 or length(coalesce(v_row->>'description','')) > 20000
            or (v_row->>'status') is null or (v_row->>'status') not in ('backlog','todo','in_progress','review','done','blocked','cancelled') then
            raise exception 'Invalid title, status, or description in import row %', v_row->>'sourceRow';
          end if;
          v_date := null;
          if nullif(v_row->>'due_date','') is not null then
            if (v_row->>'due_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Use unambiguous ISO dates'; end if;
            v_date := (v_row->>'due_date')::date;
            if to_char(v_date,'YYYY-MM-DD') <> v_row->>'due_date' then raise exception 'Invalid date'; end if;
          end if;
          v_worker := nullif(v_row->>'worker_id','')::uuid;

          v_source := coalesce(v_row->'source','{}'::jsonb);
          if jsonb_typeof(v_source) <> 'object' or octet_length(v_source::text)>8000 then raise exception 'Invalid import source'; end if;
          v_description := nullif(concat_ws(E'\n\n', nullif(v_row->>'description',''),
            'Imported record — not synchronized with the source.' || E'\n'
            || concat_ws(E'\n',
              case when nullif(v_source->>'id','') is not null then 'Source ID: ' || (v_source->>'id') end,
              case when nullif(coalesce(v_source->>'original_url',v_source->>'url'),'') is not null then 'Source URL: ' || coalesce(v_source->>'original_url',v_source->>'url') end,
              case when nullif(v_source->>'status','') is not null then 'Source status: ' || (v_source->>'status') end,
              case when nullif(v_source->>'assignee','') is not null then 'Source assignee: ' || (v_source->>'assignee') end,
              case when nullif(v_source->>'due_date','') is not null then 'Source due date: ' || (v_source->>'due_date') end
            )), '');
          insert into public.elements(object_id,title,description,status,due_date,progress,owner_id,is_approval,approval_state)
            values(v_object,btrim(v_row->>'title'),v_description,v_row->>'status',v_date,
              case when v_row->>'status'='done' then 100 else null end,null,false,null) returning id into v_id;
          insert into public.element_objects(element_id,object_id) values(v_id,v_object) on conflict do nothing;
          if v_worker is not null then
            -- Checked against the Element just written, like every other
            -- assignment; a refusal rolls back the whole import.
            if not public.worker_assignable(v_worker, v_id) then
              raise exception 'An assignee is no longer available in this Space' using errcode='42501';
            end if;
            insert into public.element_assignees(element_id,worker_id,role) values(v_id,v_worker,'assignee');
          end if;
          v_result := v_result || jsonb_build_array(jsonb_build_object('rowKey',v_row->>'rowKey','elementId',v_id));
        end loop;
        insert into public.work_import_receipts(id,created_by,activity_space_id,object_id,request,result)
          values(p_batch_id,v_user,p_space_id,v_object,v_request,v_result);
        return jsonb_build_object('saved',v_result,'objectId',v_object,'replayed',false);
      end;
      $b$
    $f$;
  end if;

  -- ── A Domain or Object keeps at least one owner, like a Space ───────────
  -- Deleting the scope itself, or the person's account, cascades through.
  -- An owner or admin of an Object's Domain who removes its last owner (e.g.
  -- someone who left the Domain) takes the ownership over in the same
  -- statement, so the Object is never left without an owner and the people
  -- who manage it can always revoke access.
  execute $f$
    create or replace function alcon_internal.guard_last_scope_owner()
    returns trigger language plpgsql security definer set search_path = ''
    as $b$
    declare
      v_scope uuid := (to_jsonb(old) ->> tg_argv[0])::uuid;
      v_exists boolean;
      v_others integer;
    begin
      if old.role <> 'owner' or (tg_op = 'UPDATE' and new.role = 'owner') then
        return coalesce(new, old);
      end if;
      execute format('select exists (select 1 from public.%I where id = $1)', tg_argv[1]) into v_exists using v_scope;
      if not v_exists or not exists (select 1 from auth.users where id = old.user_id) then
        return coalesce(new, old);
      end if;
      execute format('select 1 from public.%I where id = $1 for update', tg_argv[1]) using v_scope;
      execute format('select count(*) from public.%I where %I = $1 and role = ''owner'' and user_id <> $2',
                     tg_table_name, tg_argv[0])
        into v_others using v_scope, old.user_id;
      if v_others > 0 then
        return coalesce(new, old);
      end if;
      if tg_op = 'DELETE' and tg_table_name = 'object_members'
         and auth.uid() is not null and old.user_id <> auth.uid()
         and alcon_internal.user_manages_scope_as(auth.uid(), 'object', v_scope) then
        insert into public.object_members (object_id, user_id, role)
        values (v_scope, auth.uid(), 'owner')
        on conflict (object_id, user_id) do update set role = 'owner';
        return old;
      end if;
      raise exception '% must keep at least one owner', tg_argv[2] using errcode = '23514';
    end
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.guard_last_scope_owner() from public, anon, authenticated';
  execute 'drop trigger if exists domain_members_guard_last_owner on public.domain_members';
  execute 'create trigger domain_members_guard_last_owner before delete or update on public.domain_members
    for each row execute function alcon_internal.guard_last_scope_owner(''domain_id'', ''domains'', ''A Domain'')';
  execute 'drop trigger if exists object_members_guard_last_owner on public.object_members';
  execute 'create trigger object_members_guard_last_owner before delete or update on public.object_members
    for each row execute function alcon_internal.guard_last_scope_owner(''object_id'', ''objects'', ''An Object'')';

  -- The owners and admins of an Object's Domain see and remove its members
  -- without joining it first (om delete already lets them delete).
  execute 'drop policy if exists "om select domain managers" on public.object_members';
  execute 'create policy "om select domain managers" on public.object_members
    for select to authenticated
    using (alcon_internal.user_manages_scope_as(auth.uid(), ''object'', object_id))';

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
      if exists (select 1 from public.membership_invitations
                  where status = 'declined' and invitee_id = p_user
                    and coalesce(activity_space_id, domain_id, object_id) = p_scope_id
                    and responded_at > now() - interval '7 days') then
        raise exception 'This person declined an invitation here in the last 7 days' using errcode = '22023';
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

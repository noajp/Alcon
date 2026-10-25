-- A Domain can have viewers: people who read everything in it and change
-- nothing (ELE_AI-141).
--
-- domain_members.role gains 'viewer'. Two families of helpers now answer two
-- different questions:
--
--   read  user_can_read_domain / _object / _element / _strategy,
--         user_can_read_widget_subject, crm_*_readable — who may look. Every
--         member of the Domain, viewers included, plus Space members of a
--         workspace Domain. These are the previous user_can_see_* bodies.
--   work  user_can_see_domain / _object / _element (and the _as forms) — who
--         may change things. Owners, admins and members of the Domain, and
--         Space members of a workspace Domain unless they hold a viewer row
--         there. A viewer row restricts; it never widens.
--
-- Every write policy and definer RPC built on user_can_see_* keeps calling
-- it, so viewers are refused by the same checks that refuse outsiders. SELECT
-- policies and read RPCs move to the read helpers; FOR ALL policies that also
-- served reads are split into a read SELECT policy and work INSERT / UPDATE /
-- DELETE policies; writes that were gated only through a parent row's
-- visibility now also ask the work question.
--
-- Object membership is unchanged: an Object member works in that Object even
-- when they only view its Domain.
--
-- Membership: invitations carry a role (member, or viewer for a Domain);
-- invite_member takes p_role; respond_to_invite enrols with the invitation's
-- role; set_domain_member_role lets a Domain's owners and admins change a
-- member's role (only owners grant or remove ownership; the last-owner guard
-- still applies). A viewer of a workspace Domain who is a Space member cannot
-- remove their own row, because that would lift the restriction.
--
-- Guarded for preview replay: the base schema lives outside this folder.
do $mig$
begin
  if to_regclass('public.domains') is null
     or to_regclass('public.domain_members') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.element_objects') is null
     or to_regclass('public.object_domains') is null
     or to_regprocedure('public.user_is_object_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('alcon_internal.user_is_object_member_as(uuid, uuid)') is null
     or to_regprocedure('alcon_internal.is_activity_space_member_as(uuid, uuid)') is null then
    raise notice 'domain_viewer_role skipped: base schema not present';
    return;
  end if;

  -- ── Roles ──────────────────────────────────────────────────────────────
  execute 'alter table public.domain_members drop constraint if exists domain_members_role_check';
  execute $ddl$alter table public.domain_members add constraint domain_members_role_check
    check (role in ('owner', 'admin', 'member', 'viewer'))$ddl$;

  -- ── Read helpers: who may look ─────────────────────────────────────────
  execute $f$
    create or replace function public.user_can_read_domain(_domain_id uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (
        select 1 from domains d
        where d.id = _domain_id
          and (
            exists (select 1 from domain_members m where m.domain_id = d.id and m.user_id = auth.uid())
            or (d.privacy = 'workspace'
                and d.activity_space_id is not null
                and public.is_activity_space_member(d.activity_space_id))
          )
      );
    $b$
  $f$;

  execute $f$
    create or replace function public.user_can_read_object(_object_id uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select
        public.user_is_object_member(_object_id)
        or exists (select 1 from objects o
                   where o.id = _object_id and o.domain_id is not null
                     and public.user_can_read_domain(o.domain_id))
        or exists (select 1 from object_domains od
                   where od.object_id = _object_id
                     and public.user_can_read_domain(od.domain_id));
    $b$
  $f$;

  execute $f$
    create or replace function public.user_can_read_element(_element_id uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select
        exists (
          select 1 from elements e
          where e.id = _element_id
            and (
              e.owner_id = auth.uid()
              or (e.object_id is not null and public.user_can_read_object(e.object_id))
              or (e.object_id is null and e.owner_id is null
                  and not exists (select 1 from element_objects eo where eo.element_id = e.id))
            )
        )
        or exists (
          select 1 from element_objects eo
          where eo.element_id = _element_id and public.user_can_read_object(eo.object_id)
        );
    $b$
  $f$;

  execute 'grant execute on function public.user_can_read_domain(uuid) to anon, authenticated, service_role';
  execute 'grant execute on function public.user_can_read_object(uuid) to anon, authenticated, service_role';
  execute 'grant execute on function public.user_can_read_element(uuid) to anon, authenticated, service_role';

  -- The same read rule for another user (notifications).
  execute $f$
    create or replace function alcon_internal.user_can_read_domain_as(p_domain uuid, p_user uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (
        select 1 from public.domains d
        where d.id = p_domain
          and (
            exists (select 1 from public.domain_members m where m.domain_id = d.id and m.user_id = p_user)
            or (d.privacy = 'workspace'
                and d.activity_space_id is not null
                and alcon_internal.is_activity_space_member_as(d.activity_space_id, p_user))
          )
      );
    $b$
  $f$;
  execute $f$
    create or replace function alcon_internal.user_can_read_object_as(p_object uuid, p_user uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select
        alcon_internal.user_is_object_member_as(p_object, p_user)
        or exists (select 1 from public.objects o
                   where o.id = p_object and o.domain_id is not null
                     and alcon_internal.user_can_read_domain_as(o.domain_id, p_user))
        or exists (select 1 from public.object_domains od
                   where od.object_id = p_object
                     and alcon_internal.user_can_read_domain_as(od.domain_id, p_user));
    $b$
  $f$;
  execute $f$
    create or replace function alcon_internal.user_can_read_element_as(p_element uuid, p_user uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select
        exists (
          select 1 from public.elements e
          where e.id = p_element
            and (
              e.owner_id = p_user
              or (e.object_id is not null and alcon_internal.user_can_read_object_as(e.object_id, p_user))
              or (e.object_id is null and e.owner_id is null
                  and not exists (select 1 from public.element_objects eo where eo.element_id = e.id))
            )
        )
        or exists (
          select 1 from public.element_objects eo
          where eo.element_id = p_element and alcon_internal.user_can_read_object_as(eo.object_id, p_user)
        );
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.user_can_read_domain_as(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.user_can_read_object_as(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.user_can_read_element_as(uuid, uuid) from public, anon, authenticated';

  -- ── Work helpers: who may change things ────────────────────────────────
  -- Signatures, security and search_path unchanged; create or replace keeps
  -- the grants. user_can_see_object / _element compose user_can_see_domain,
  -- so they follow.
  execute $f$
    create or replace function public.user_can_see_domain(_domain_id uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (
        select 1 from domains d
        where d.id = _domain_id
          and (
            exists (select 1 from domain_members m
                     where m.domain_id = d.id and m.user_id = auth.uid()
                       and m.role in ('owner', 'admin', 'member'))
            or (d.privacy = 'workspace'
                and d.activity_space_id is not null
                and public.is_activity_space_member(d.activity_space_id)
                and not exists (select 1 from domain_members m
                                 where m.domain_id = d.id and m.user_id = auth.uid()
                                   and m.role = 'viewer'))
          )
      );
    $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.user_can_see_domain_as(p_domain uuid, p_user uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (
        select 1 from public.domains d
        where d.id = p_domain
          and (
            exists (select 1 from public.domain_members m
                     where m.domain_id = d.id and m.user_id = p_user
                       and m.role in ('owner', 'admin', 'member'))
            or (d.privacy = 'workspace'
                and d.activity_space_id is not null
                and alcon_internal.is_activity_space_member_as(d.activity_space_id, p_user)
                and not exists (select 1 from public.domain_members m
                                 where m.domain_id = d.id and m.user_id = p_user
                                   and m.role = 'viewer'))
          )
      );
    $b$
  $f$;

  -- ── Strategy and widget subjects ───────────────────────────────────────
  if to_regclass('public.strategies') is not null and to_regclass('public.strategy_objects') is not null then
    execute $f$
      create or replace function public.user_can_read_strategy(_strategy_id uuid)
      returns boolean language sql stable security definer set search_path = public as $b$
        select
          exists (select 1 from public.strategies s
                   where s.id = _strategy_id and s.created_by = auth.uid())
          or exists (select 1 from public.strategy_objects so
                      where so.strategy_id = _strategy_id
                        and public.user_can_read_object(so.object_id));
      $b$
    $f$;
    execute 'grant execute on function public.user_can_read_strategy(uuid) to anon, authenticated, service_role';

    execute $f$
      create or replace function public.user_can_read_widget_subject(_kind text, _id uuid)
      returns boolean language sql stable set search_path = '' as $b$
        select case _kind
          when 'me' then _id = (select auth.uid())
          when 'domain' then public.user_can_read_domain(_id)
          when 'object' then public.user_can_read_object(_id)
          when 'element' then public.user_can_read_element(_id)
          when 'initiative' then public.user_can_read_strategy(_id)
          else false
        end
      $b$
    $f$;
    execute 'revoke all on function public.user_can_read_widget_subject(text, uuid) from public, anon';
    execute 'grant execute on function public.user_can_read_widget_subject(text, uuid) to authenticated, service_role';

    if to_regprocedure('public.board_presence_allowed(text)') is not null then
      execute $f$
CREATE OR REPLACE FUNCTION public.board_presence_allowed(p_topic text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
      select case
        when p_topic ~ '^board:(domain|object|element|initiative):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then public.user_can_read_widget_subject(split_part(p_topic, ':', 2), split_part(p_topic, ':', 3)::uuid)
        else false
      end
    $function$
      $f$;
    end if;
  end if;

  -- ── CRM read helpers ───────────────────────────────────────────────────
  if to_regclass('public.crm_pipelines') is not null
     and to_regclass('public.crm_deals') is not null
     and to_regclass('public.crm_companies') is not null
     and to_regclass('public.crm_contacts') is not null then
    execute $f$
      create or replace function public.crm_scope_readable(p_space uuid, p_domain uuid)
      returns boolean language sql stable security definer set search_path = public as $b$
        select case
          when p_domain is null then public.is_activity_space_member(p_space)
          else exists (select 1 from public.domains d where d.id = p_domain and d.activity_space_id = p_space)
               and public.user_can_read_domain(p_domain)
        end;
      $b$
    $f$;
    execute $f$
      create or replace function public.crm_pipeline_readable(p_pipeline uuid)
      returns boolean language sql stable security definer set search_path = public as $b$
        select coalesce((select public.crm_scope_readable(p.activity_space_id, p.domain_id)
                           from public.crm_pipelines p where p.id = p_pipeline), false);
      $b$
    $f$;
    execute $f$
      create or replace function public.crm_activity_readable(p_space uuid, p_deal uuid, p_company uuid, p_contact uuid)
      returns boolean language sql stable security definer set search_path = public as $b$
        select (p_deal is not null or p_company is not null or p_contact is not null)
          and (p_deal is null or coalesce((select d.activity_space_id = p_space and public.crm_pipeline_readable(d.pipeline_id) from public.crm_deals d where d.id = p_deal), false))
          and (p_company is null or coalesce((select c.activity_space_id = p_space and public.crm_scope_readable(c.activity_space_id, c.domain_id) from public.crm_companies c where c.id = p_company), false))
          and (p_contact is null or coalesce((select c.activity_space_id = p_space and public.crm_scope_readable(c.activity_space_id, c.domain_id) from public.crm_contacts c where c.id = p_contact), false));
      $b$
    $f$;
    execute $f$
      create or replace function public.crm_record_readable(p_table text, p_id uuid)
      returns boolean language sql stable security definer set search_path = public as $b$
        select p_id is null or coalesce(case p_table
          when 'company' then (select public.crm_scope_readable(c.activity_space_id, c.domain_id) from public.crm_companies c where c.id = p_id)
          when 'contact' then (select public.crm_scope_readable(c.activity_space_id, c.domain_id) from public.crm_contacts c where c.id = p_id)
        end, false);
      $b$
    $f$;
    execute 'revoke all on function public.crm_scope_readable(uuid, uuid) from public, anon';
    execute 'revoke all on function public.crm_pipeline_readable(uuid) from public, anon';
    execute 'revoke all on function public.crm_activity_readable(uuid, uuid, uuid, uuid) from public, anon';
    execute 'revoke all on function public.crm_record_readable(text, uuid) from public, anon';
    execute 'grant execute on function public.crm_scope_readable(uuid, uuid) to authenticated, service_role';
    execute 'grant execute on function public.crm_pipeline_readable(uuid) to authenticated, service_role';
    execute 'grant execute on function public.crm_activity_readable(uuid, uuid, uuid, uuid) to authenticated, service_role';
    execute 'grant execute on function public.crm_record_readable(text, uuid) to authenticated, service_role';
  end if;

  -- ── Read paths that are definer functions ──────────────────────────────
  -- Bodies are the production definitions with the see helpers swapped for
  -- the read helpers; signatures, security, search_path and grants unchanged.
  if to_regprocedure('alcon_internal.user_can_list_worker(uuid)') is not null then
    execute $f$
CREATE OR REPLACE FUNCTION alcon_internal.user_can_list_worker(p_worker uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      select auth.uid() is not null and exists (
        select 1 from public.workers w
        where w.id = p_worker and (
          w.user_id = auth.uid()
          or (w.object_id is not null and public.user_can_read_object(w.object_id))
          or (w.object_id is null and w.user_id is not null and (
               exists (select 1 from public.activity_space_members mine
                         join public.activity_space_members theirs
                           on theirs.activity_space_id = mine.activity_space_id
                        where mine.user_id = auth.uid() and theirs.user_id = w.user_id)
               or exists (select 1 from public.domain_members dm
                           where dm.user_id = w.user_id and public.user_can_read_domain(dm.domain_id))
               or exists (select 1 from public.object_members om
                           where om.user_id = w.user_id and public.user_can_read_object(om.object_id))))
          or (w.user_id is null and w.object_id is null and w.activity_space_id is not null
              and public.is_activity_space_member(w.activity_space_id))));
    $function$
    $f$;
  end if;
  if to_regprocedure('alcon_internal.user_can_see_worker(uuid)') is not null then
    execute $f$
CREATE OR REPLACE FUNCTION alcon_internal.user_can_see_worker(p_worker uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      select auth.uid() is not null and (
        alcon_internal.user_can_list_worker(p_worker)
        or exists (select 1 from public.element_assignees ea
                    where ea.worker_id = p_worker and public.user_can_read_element(ea.element_id))
        or exists (select 1 from public.objects o
                    where o.lead_id = p_worker and public.user_can_read_object(o.id)
                      and alcon_internal.worker_in_space(p_worker, alcon_internal.object_home_space(o.id)))
        or exists (select 1 from public.custom_column_values v
                     join public.custom_columns c on c.id = v.column_id
                    where c.column_type = 'person' and v.value = to_jsonb(p_worker::text)
                      and v.element_id is not null and public.user_can_read_element(v.element_id)
                      and alcon_internal.worker_in_space(p_worker, alcon_internal.element_home_space(v.element_id))));
    $function$
    $f$;
  end if;
  if to_regprocedure('alcon_internal.custom_column_readable(uuid, uuid, uuid, uuid, uuid)') is not null then
    execute $f$
CREATE OR REPLACE FUNCTION alcon_internal.custom_column_readable(p_column uuid, p_object uuid, p_domain uuid, p_space uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      select auth.uid() is not null and (
        (p_object is not null and public.user_can_read_object(p_object))
        or (p_domain is not null and (
              public.user_can_read_domain(p_domain)
              or exists (select 1 from public.objects o
                          where o.domain_id = p_domain and public.user_can_read_object(o.id))
              or exists (select 1 from public.object_domains od
                          where od.domain_id = p_domain and public.user_can_read_object(od.object_id))))
        or (p_space is not null and (
              public.is_activity_space_member(p_space)
              or exists (select 1 from public.custom_column_placements pl
                          where pl.column_id = p_column and pl.object_id is not null
                            and public.user_can_read_object(pl.object_id))))
        or (p_owner is not null and p_owner = auth.uid()));
    $function$
    $f$;
  end if;
  if to_regprocedure('public.get_explorer_data(uuid, uuid)') is not null then
    execute $f$
CREATE OR REPLACE FUNCTION public.get_explorer_data(p_domain_id uuid DEFAULT NULL::uuid, p_object_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    with
    scoped_objects as (
      select o.*
      from objects o
      where public.user_can_read_object(o.id)
        and case
              when p_object_id is not null then o.id = p_object_id
              else o.archived_at is null
                   and (
                     p_domain_id is null
                     or o.domain_id = p_domain_id
                     or exists (
                          select 1 from object_domains od
                          where od.object_id = o.id and od.domain_id = p_domain_id
                        )
                   )
            end
    ),
    base_elements as (
      select e.* from elements e where e.owner_id is null
    ),
    elem_objids as (
      select be.id as element_id,
             coalesce(
               (select array_agg(eo.object_id order by eo.order_index, be.seq_number)
                  from element_objects eo where eo.element_id = be.id),
               case when be.object_id is not null then array[be.object_id]
                    else array[]::uuid[] end
             ) as object_ids
      from base_elements be
    ),
    enriched as (
      select be.id,
             be.object_id,
             be.order_index,
             be.seq_number,
             to_jsonb(be.*)
               || jsonb_build_object(
                    'subelements',
                      coalesce((select jsonb_agg(to_jsonb(s.*) order by s.order_index)
                                  from subelements s where s.element_id = be.id), '[]'::jsonb),
                    'assignees',
                      coalesce((select jsonb_agg(
                                  to_jsonb(a.*)
                                  || jsonb_build_object('worker',
                                       (select to_jsonb(w.*) from workers w where w.id = a.worker_id)))
                                  from element_assignees a where a.element_id = be.id), '[]'::jsonb),
                    'objectIds', to_jsonb(eo.object_ids),
                    'isMultiHomed', (coalesce(array_length(eo.object_ids, 1), 0) > 1)
                  ) as obj
      from base_elements be
      join elem_objids eo on eo.element_id = be.id
    ),
    obj_elements as (
      select so.id as object_id,
             coalesce((
               select jsonb_agg(en.obj order by en.order_index nulls last, en.seq_number nulls last)
                 from element_objects eo
                 join enriched en on en.id = eo.element_id
                where eo.object_id = so.id
             ), '[]'::jsonb) as elements
      from scoped_objects so
    )
    select jsonb_build_object(
      'objects', coalesce((
        select jsonb_agg(
                 to_jsonb(so.*)
                 || jsonb_build_object(
                      'elements', oe.elements,
                      'children', '[]'::jsonb,
                      'parentIds', '[]'::jsonb,
                      'isMultiHomed', false
                    )
                 order by so.order_index)
          from scoped_objects so
          join obj_elements oe on oe.object_id = so.id
      ), '[]'::jsonb),
      'rootElements', case when p_object_id is not null then '[]'::jsonb else coalesce((
        select jsonb_agg(en.obj order by en.order_index nulls last, en.seq_number nulls last)
          from enriched en
         where en.object_id is null
           and not exists (select 1 from element_objects eo where eo.element_id = en.id)
      ), '[]'::jsonb) end
    );
    $function$
    $f$;
  end if;
  if to_regprocedure('public.get_now_work(uuid)') is not null then
    execute $f$
CREATE OR REPLACE FUNCTION public.get_now_work(p_space_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    declare
      v_objects uuid[];
      v_elements uuid[];
      v_result jsonb;
    begin
      if auth.uid() is null then raise exception using errcode='42501', message='Sign in to read Space work.'; end if;
      if p_space_id is null then raise exception using errcode='22023', message='Select a Space.'; end if;
      -- Explicit Object membership also admits a guest; Space membership is not
      -- required when canonical visibility grants a narrower view of this Space.
      -- Archived Objects are not current work.
      select coalesce(array_agg(o.id), '{}') into v_objects from public.objects o
      where public.user_can_read_object(o.id)
        and o.archived_at is null
        and (exists (select 1 from public.domains d where d.id=o.domain_id and d.activity_space_id=p_space_id)
          or exists (select 1 from public.object_domains od join public.domains d on d.id=od.domain_id
            where od.object_id=o.id and d.activity_space_id=p_space_id));
      select coalesce(array_agg(e.id), '{}') into v_elements from public.elements e
      where public.user_can_read_element(e.id)
        and (e.object_id=any(v_objects) or exists (
          select 1 from public.element_objects eo where eo.element_id=e.id and eo.object_id=any(v_objects)));
      if cardinality(v_objects)>10000 or cardinality(v_elements)>20000 then
        raise exception using errcode='54000', message='This Space exceeds the Now read limit. Open an Object to continue.';
      end if;
      with scoped_workers as materialized (
        select w.* from public.workers w where exists (
          select 1 from public.element_assignees ea where ea.worker_id=w.id and ea.element_id=any(v_elements))
          or w.object_id=any(v_objects)
          or (exists(select 1 from public.activity_space_members mine where mine.activity_space_id=p_space_id and mine.user_id=auth.uid())
            and w.object_id is null
            and exists(select 1 from public.activity_space_members member where member.activity_space_id=p_space_id and member.user_id=w.user_id))
      ), worker_rows as materialized (
        select w.id, to_jsonb(w) || jsonb_build_object('ai_config',null,'email',null,
          'object_id',case when w.object_id=any(v_objects) then w.object_id else null end) as item
        from scoped_workers w
      ), element_rows as (
        select e.id, to_jsonb(e) || jsonb_build_object(
          'object_id',case when e.object_id=any(v_objects) then e.object_id else null end,
          'objectIds', h.ids, 'isMultiHomed',jsonb_array_length(h.ids)>1,
          'objects', h.objects,
          'assignees', coalesce((select jsonb_agg(to_jsonb(ea) || jsonb_build_object('worker',w.item) order by ea.id)
            from public.element_assignees ea left join worker_rows w on w.id=ea.worker_id where ea.element_id=e.id), '[]'::jsonb),
          'subelements',coalesce((select jsonb_agg(to_jsonb(s) order by s.order_index,s.id)
            from public.subelements s where s.element_id=e.id), '[]'::jsonb)
        ) as item
        from public.elements e cross join lateral (
          select coalesce(jsonb_agg(o.id order by o.id),'[]'::jsonb) as ids,
            coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.id),'[]'::jsonb) as objects
          from public.objects o where o.id=any(v_objects) and (o.id=e.object_id or exists (
            select 1 from public.element_objects eo where eo.element_id=e.id and eo.object_id=o.id))
        ) h where e.id=any(v_elements)
      ), edge_rows as (
        select ed.id, case when ed.from_element=any(v_elements) and ed.to_element=any(v_elements)
          then to_jsonb(ed) else jsonb_build_object('id',ed.id,'from_element',ed.from_element,
            'to_element',ed.to_element,'edge_type','depends_on','attributes','{}'::jsonb,'created_at',null,'created_by',null) end as item
        from public.element_edges ed where ed.edge_type='depends_on'
          and (ed.from_element=any(v_elements) or ed.to_element=any(v_elements))
      )
      select jsonb_build_object(
        'elements',coalesce((select jsonb_agg(item order by id) from element_rows),'[]'::jsonb),
        'workers',coalesce((select jsonb_agg(item order by id) from worker_rows),'[]'::jsonb),
        'objects',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'domain_id',
          case when exists(select 1 from public.domains d where d.id=o.domain_id and d.activity_space_id=p_space_id
            and public.user_can_read_domain(d.id)) then o.domain_id else null end) order by o.id)
          from public.objects o where o.id=any(v_objects)),'[]'::jsonb),
        'edges',coalesce((select jsonb_agg(item order by id) from edge_rows),'[]'::jsonb),
        'readAt',statement_timestamp()
      ) into v_result;
      -- A single scalar JSON result cannot be silently truncated by PostgREST's
      -- row cap. Never turn resource protection into partial, falsely-ready data.
      if octet_length(v_result::text)>25000000 then
        raise exception using errcode='54000', message='This Space exceeds the Now response limit. Open an Object to continue.';
      end if;
      return v_result;
    end;
    $function$
    $f$;
  end if;
  -- Listing a Domain's people reads it; who can be assigned still asks who
  -- works there (worker_assignable, user_can_see_domain_as).
  if to_regprocedure('public.list_assignable_workers(uuid, uuid, uuid, boolean)') is not null then
    execute $f$
CREATE OR REPLACE FUNCTION public.list_assignable_workers(p_space_id uuid DEFAULT NULL::uuid, p_domain_id uuid DEFAULT NULL::uuid, p_element_id uuid DEFAULT NULL::uuid, p_include_inactive boolean DEFAULT false)
 RETURNS SETOF workers
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    declare
      v_space uuid := p_space_id;
    begin
      if auth.uid() is null then return; end if;
      if p_element_id is not null then
        if not public.user_can_see_element(p_element_id) then return; end if;
        return query
          select w.* from public.workers w
           where public.worker_assignable(w.id, p_element_id)
           order by w.type, w.name;
        return;
      end if;
      if p_domain_id is not null then
        if not public.user_can_read_domain(p_domain_id) then return; end if;
        v_space := coalesce((select d.activity_space_id from public.domains d where d.id = p_domain_id), p_space_id);
      end if;
      return query
        select w.* from public.workers w
         where alcon_internal.user_can_list_worker(w.id)
           and (v_space is null or alcon_internal.worker_in_space(w.id, v_space))
           and (p_domain_id is null or w.user_id is null
                or alcon_internal.user_can_see_domain_as(p_domain_id, w.user_id))
           and (p_include_inactive or w.status is distinct from 'inactive' or w.user_id = auth.uid())
         order by w.type, w.name;
    end;
    $function$
    $f$;
  end if;
  -- A viewer named in or following a thread hears about it.
  if to_regprocedure('public.notify_element_comment()') is not null
     and to_regprocedure('public.alcon_restoring()') is not null then
    execute $f$
CREATE OR REPLACE FUNCTION public.notify_element_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    declare
      v_element text;
      v_author  text := coalesce(nullif(new.author_name, ''), 'Someone');
    begin
      if public.alcon_restoring() then return new; end if;
      select e.title into v_element from elements e where e.id = new.element_id;
      if v_element is null then return new; end if; -- element gone; nothing to say

      -- Named people, whoever wrote the comment. For an agent this is the
      -- whole delivery path. Only people who can see the Element.
      insert into notifications
        (recipient_id, actor_id, actor_name, kind, element_id, comment_id, title, body)
      select distinct m, new.author_id, new.author_name, 'mention',
             new.element_id, new.id,
             v_author || ' mentioned you in ' || v_element, left(new.content, 140)
      from unnest(new.mentions) as m
      where (new.author_id is null or m <> new.author_id)
        and alcon_internal.user_can_read_element_as(new.element_id, m);

      if new.author_kind = 'ai_agent' then
        return new;
      end if;

      -- Written by a person: the users behind assigned Workers, the Element's
      -- owner, the owner of the Domain it lives in, and everyone already in
      -- the thread — minus the author, minus anyone named above, and minus
      -- anyone who can no longer see the Element.
      insert into notifications
        (recipient_id, actor_id, actor_name, kind, element_id, comment_id, title, body)
      select distinct r.user_id, new.author_id, new.author_name, 'comment',
             new.element_id, new.id,
             v_author || ' commented on ' || v_element, left(new.content, 140)
      from (
        select w.user_id
        from element_assignees ea
        join workers w on w.id = ea.worker_id
        where ea.element_id = new.element_id and w.user_id is not null
        union
        select e.owner_id from elements e
        where e.id = new.element_id and e.owner_id is not null
        union
        select d.user_id
        from elements e
        join objects o on o.id = e.object_id
        join domains d on d.id = o.domain_id
        where e.id = new.element_id and d.user_id is not null
        union
        select c.author_id
        from element_comments c
        where c.element_id = new.element_id
          and c.author_kind = 'human'
          and c.author_id is not null
      ) r
      where r.user_id is not null
        and (new.author_id is null or r.user_id <> new.author_id)
        and not (r.user_id = any (new.mentions))
        and alcon_internal.user_can_read_element_as(new.element_id, r.user_id);

      return new;
    end
  $function$
    $f$;
  end if;

  -- ── Domains, Objects, Elements ─────────────────────────────────────────
  execute 'drop policy if exists "objects select visible" on public.objects';
  execute 'create policy "objects select visible" on public.objects
    for select
    using (
      public.user_is_object_member(id)
      or (domain_id is not null and public.user_can_read_domain(domain_id))
      or exists (select 1 from public.object_domains od
                  where od.object_id = objects.id and public.user_can_read_domain(od.domain_id))
    )';

  execute 'drop policy if exists "elements select visible" on public.elements';
  execute 'create policy "elements select visible" on public.elements
    for select
    using (
      owner_id = auth.uid()
      or (object_id is not null and public.user_can_read_object(object_id))
      or exists (select 1 from public.element_objects eo
                  where eo.element_id = elements.id and public.user_can_read_object(eo.object_id))
      or (object_id is null and owner_id is null
          and not exists (select 1 from public.element_objects eo where eo.element_id = elements.id))
    )';

  -- A personal Element placed in an Object needs work rights there, like any
  -- other Element in it.
  execute 'drop policy if exists "elements insert allowed" on public.elements';
  execute 'create policy "elements insert allowed" on public.elements
    for insert
    with check (
      (owner_id = auth.uid() and (object_id is null or public.user_can_see_object(object_id)))
      or (object_id is not null and public.user_can_see_object(object_id))
      or (object_id is null and owner_id is null)
    )';

  execute 'drop policy if exists "elements update visible" on public.elements';
  execute 'create policy "elements update visible" on public.elements
    for update
    using (
      owner_id = auth.uid()
      or (object_id is not null and public.user_can_see_object(object_id))
      or exists (select 1 from public.element_objects eo
                  where eo.element_id = elements.id and public.user_can_see_object(eo.object_id))
      or (object_id is null and owner_id is null
          and not exists (select 1 from public.element_objects eo where eo.element_id = elements.id))
    )
    with check (
      (owner_id = auth.uid() and (object_id is null or public.user_can_see_object(object_id)))
      or (object_id is not null and public.user_can_see_object(object_id))
      or (object_id is null and owner_id is null)
    )';

  execute 'drop policy if exists "element_objects via visible object" on public.element_objects';
  execute 'drop policy if exists element_objects_select on public.element_objects';
  execute 'drop policy if exists element_objects_insert on public.element_objects';
  execute 'drop policy if exists element_objects_update on public.element_objects';
  execute 'drop policy if exists element_objects_delete on public.element_objects';
  execute 'create policy element_objects_select on public.element_objects for select
    using (public.user_can_read_object(object_id) and public.user_can_read_element(element_id))';
  execute 'create policy element_objects_insert on public.element_objects for insert
    with check (public.user_can_see_object(object_id) and public.user_can_see_element(element_id))';
  execute 'create policy element_objects_update on public.element_objects for update
    using (public.user_can_see_object(object_id) and public.user_can_see_element(element_id))
    with check (public.user_can_see_object(object_id) and public.user_can_see_element(element_id))';
  execute 'create policy element_objects_delete on public.element_objects for delete
    using (public.user_can_see_object(object_id) and public.user_can_see_element(element_id))';

  execute 'drop policy if exists object_domains_visible_select on public.object_domains';
  execute 'create policy object_domains_visible_select on public.object_domains
    for select to authenticated
    using (public.user_can_read_domain(domain_id) and public.user_can_read_object(object_id))';

  -- A viewer leaves a private Domain freely. In a workspace Domain of a Space
  -- they belong to, their row is what keeps them read-only, so a manager
  -- removes it.
  execute 'drop policy if exists "dm delete self or owner" on public.domain_members';
  execute 'create policy "dm delete self or owner" on public.domain_members
    for delete
    using (
      (user_id = auth.uid()
       and (role <> ''viewer''
            or not exists (select 1 from public.domains d
                            where d.id = domain_members.domain_id
                              and d.privacy = ''workspace''
                              and d.activity_space_id is not null
                              and public.is_activity_space_member(d.activity_space_id))))
      or public.user_has_domain_role(domain_id, array[''owner'', ''admin''])
    )';

  if to_regclass('public.phases') is not null then
    execute 'drop policy if exists "phases select visible" on public.phases';
    execute 'create policy "phases select visible" on public.phases
      for select using (public.user_can_read_domain(domain_id))';
  end if;

  if to_regclass('public.element_templates') is not null then
    execute 'drop policy if exists element_templates_select on public.element_templates';
    execute 'create policy element_templates_select on public.element_templates
      for select to authenticated using (public.user_can_read_domain(domain_id))';
  end if;

  -- ── Element children ───────────────────────────────────────────────────
  if to_regclass('public.subelements') is not null then
    execute 'drop policy if exists subelements_follow_element on public.subelements';
    execute 'drop policy if exists subelements_select on public.subelements';
    execute 'drop policy if exists subelements_insert on public.subelements';
    execute 'drop policy if exists subelements_update on public.subelements';
    execute 'drop policy if exists subelements_delete on public.subelements';
    execute 'create policy subelements_select on public.subelements for select to authenticated
      using (public.user_can_read_element(element_id))';
    execute 'create policy subelements_insert on public.subelements for insert to authenticated
      with check (public.user_can_see_element(element_id))';
    execute 'create policy subelements_update on public.subelements for update to authenticated
      using (public.user_can_see_element(element_id)) with check (public.user_can_see_element(element_id))';
    execute 'create policy subelements_delete on public.subelements for delete to authenticated
      using (public.user_can_see_element(element_id))';
  end if;

  if to_regclass('public.element_comments') is not null then
    execute 'drop policy if exists element_comments_select on public.element_comments';
    execute 'create policy element_comments_select on public.element_comments
      for select to authenticated using (public.user_can_read_element(element_id))';
  end if;

  if to_regclass('public.element_reactions') is not null then
    execute 'drop policy if exists element_reactions_select on public.element_reactions';
    execute 'create policy element_reactions_select on public.element_reactions
      for select to authenticated
      using (case when element_id is not null then public.user_can_read_element(element_id)
                  else exists (select 1 from public.element_comments c where c.id = element_reactions.comment_id) end)';
    execute 'drop policy if exists element_reactions_insert on public.element_reactions';
    execute 'create policy element_reactions_insert on public.element_reactions
      for insert to authenticated
      with check (user_id = auth.uid()
        and case when element_id is not null then public.user_can_see_element(element_id)
                 else exists (select 1 from public.element_comments c
                               where c.id = element_reactions.comment_id
                                 and public.user_can_see_element(c.element_id)) end)';
  end if;

  if to_regclass('public.element_assignees') is not null then
    execute 'drop policy if exists element_assignees_select on public.element_assignees';
    execute 'create policy element_assignees_select on public.element_assignees
      for select to authenticated using (public.user_can_read_element(element_id))';
  end if;

  if to_regclass('public.element_activity') is not null then
    execute 'drop policy if exists element_activity_select on public.element_activity';
    execute 'create policy element_activity_select on public.element_activity
      for select using (public.user_can_read_element(element_id))';
  end if;

  if to_regclass('public.element_approvals') is not null then
    execute 'drop policy if exists element_approvals_select on public.element_approvals';
    execute 'create policy element_approvals_select on public.element_approvals
      for select to authenticated using (public.user_can_read_element(element_id))';
  end if;

  if to_regclass('public.element_check_ins') is not null then
    execute 'drop policy if exists "Read own visible check-in receipts" on public.element_check_ins';
    execute 'create policy "Read own visible check-in receipts" on public.element_check_ins
      for select to authenticated
      using (author_id = auth.uid() and public.user_can_read_element(element_id))';
  end if;

  if to_regclass('public.agent_runs') is not null then
    execute 'drop policy if exists agent_runs_select on public.agent_runs';
    execute 'create policy agent_runs_select on public.agent_runs
      for select to authenticated using (public.user_can_read_element(element_id))';
  end if;
  if to_regclass('public.agent_run_steps') is not null and to_regclass('public.agent_runs') is not null then
    execute 'drop policy if exists agent_run_steps_select on public.agent_run_steps';
    execute 'create policy agent_run_steps_select on public.agent_run_steps
      for select to authenticated
      using (exists (select 1 from public.agent_runs r
                      where r.id = agent_run_steps.run_id and public.user_can_read_element(r.element_id)))';
  end if;
  if to_regclass('public.agent_artifacts') is not null then
    execute 'drop policy if exists agent_artifacts_select on public.agent_artifacts';
    execute 'create policy agent_artifacts_select on public.agent_artifacts
      for select to authenticated using (public.user_can_read_element(element_id))';
  end if;
  if to_regclass('public.agent_actions') is not null then
    execute 'drop policy if exists agent_actions_select on public.agent_actions';
    execute 'create policy agent_actions_select on public.agent_actions
      for select to authenticated using (public.user_can_read_element(element_id))';
  end if;

  if to_regclass('public.worker_skill_evidence') is not null and to_regclass('public.worker_skills') is not null then
    execute 'drop policy if exists worker_skill_evidence_select on public.worker_skill_evidence';
    execute 'create policy worker_skill_evidence_select on public.worker_skill_evidence
      for select to authenticated
      using (public.user_can_read_element(element_id)
             and exists (select 1 from public.worker_skills s where s.id = worker_skill_evidence.skill_id))';
  end if;

  if to_regclass('public.workers') is not null
     and to_regprocedure('alcon_internal.user_can_see_worker(uuid)') is not null then
    execute 'drop policy if exists workers_select on public.workers';
    execute 'create policy workers_select on public.workers
      for select to authenticated
      using (
        user_id = (select auth.uid())
        or (user_id is null and object_id is null and activity_space_id is not null
            and public.is_activity_space_member(activity_space_id))
        or (user_id is null and object_id is not null and public.user_can_read_object(object_id))
        or alcon_internal.user_can_see_worker(id)
      )';
  end if;

  -- ── Properties ─────────────────────────────────────────────────────────
  -- The deletion log of an Object is readable by everyone who reads the
  -- Object; restore_element still asks user_can_see_object.
  if to_regclass('public.element_deletions') is not null then
    execute 'drop policy if exists element_deletions_read on public.element_deletions';
    execute 'create policy element_deletions_read on public.element_deletions for select to authenticated
      using (deleted_by = auth.uid() or owner_id = auth.uid()
             or (object_id is not null and public.user_can_read_object(object_id)))';
  end if;

  if to_regclass('public.custom_column_placements') is not null then
    execute 'drop policy if exists custom_column_placements_select on public.custom_column_placements';
    execute 'create policy custom_column_placements_select on public.custom_column_placements
      for select to authenticated
      using ((owner_user_id is not null and owner_user_id = auth.uid())
             or (object_id is not null and public.user_can_read_object(object_id)))';
  end if;

  -- custom_column_values SELECT reads through visible_*_ids, which already
  -- include viewers. Its UPDATE / DELETE used the same sets; they now also
  -- need work rights on the Element or Object.
  if to_regclass('public.custom_column_values') is not null
     and to_regprocedure('alcon_internal.readable_column_ids()') is not null
     and to_regprocedure('alcon_internal.visible_element_ids()') is not null
     and to_regprocedure('alcon_internal.visible_object_ids()') is not null
     and to_regprocedure('alcon_internal.user_can_see_custom_column(uuid)') is not null
     and to_regprocedure('alcon_internal.custom_column_fits(uuid, uuid, uuid)') is not null then
    execute 'drop policy if exists custom_column_values_update on public.custom_column_values';
    execute 'create policy custom_column_values_update on public.custom_column_values
      for update to authenticated
      using (
        column_id in (select alcon_internal.readable_column_ids())
        and ((element_id is not null and element_id in (select alcon_internal.visible_element_ids())
              and public.user_can_see_element(element_id))
             or (element_id is null and object_id in (select alcon_internal.visible_object_ids())
                 and public.user_can_see_object(object_id)))
      )
      with check (
        ((element_id is not null and public.user_can_see_element(element_id))
         or (element_id is null and object_id is not null and public.user_can_see_object(object_id)))
        and alcon_internal.user_can_see_custom_column(column_id)
        and alcon_internal.custom_column_fits(column_id, element_id, object_id)
      )';
    execute 'drop policy if exists custom_column_values_delete on public.custom_column_values';
    execute 'create policy custom_column_values_delete on public.custom_column_values
      for delete to authenticated
      using (
        column_id in (select alcon_internal.readable_column_ids())
        and ((element_id is not null and element_id in (select alcon_internal.visible_element_ids())
              and public.user_can_see_element(element_id))
             or (element_id is null and object_id in (select alcon_internal.visible_object_ids())
                 and public.user_can_see_object(object_id)))
      )';
  end if;

  -- ── CRM ────────────────────────────────────────────────────────────────
  if to_regprocedure('public.crm_scope_readable(uuid, uuid)') is not null
     and to_regprocedure('public.crm_scope_visible(uuid, uuid)') is not null then
    declare
      t text;
    begin
      foreach t in array array['crm_companies', 'crm_contacts', 'crm_fields', 'crm_pipelines'] loop
        if to_regclass('public.' || t) is not null then
          execute format('drop policy if exists %I on public.%I', t || '_visible', t);
          execute format('drop policy if exists %I on public.%I', t || '_read', t);
          execute format('drop policy if exists %I on public.%I', t || '_insert', t);
          execute format('drop policy if exists %I on public.%I', t || '_update', t);
          execute format('drop policy if exists %I on public.%I', t || '_delete', t);
          execute format('create policy %I on public.%I for select to authenticated
            using (public.crm_scope_readable(activity_space_id, domain_id))', t || '_read', t);
          execute format('create policy %I on public.%I for insert to authenticated
            with check (public.crm_scope_visible(activity_space_id, domain_id))', t || '_insert', t);
          execute format('create policy %I on public.%I for update to authenticated
            using (public.crm_scope_visible(activity_space_id, domain_id))
            with check (public.crm_scope_visible(activity_space_id, domain_id))', t || '_update', t);
          execute format('create policy %I on public.%I for delete to authenticated
            using (public.crm_scope_visible(activity_space_id, domain_id))', t || '_delete', t);
        end if;
      end loop;
    end;

    execute 'drop policy if exists crm_deals_visible on public.crm_deals';
    execute 'drop policy if exists crm_deals_read on public.crm_deals';
    execute 'drop policy if exists crm_deals_insert on public.crm_deals';
    execute 'drop policy if exists crm_deals_update on public.crm_deals';
    execute 'drop policy if exists crm_deals_delete on public.crm_deals';
    execute 'create policy crm_deals_read on public.crm_deals for select to authenticated
      using (public.crm_pipeline_readable(pipeline_id))';
    execute 'create policy crm_deals_insert on public.crm_deals for insert to authenticated
      with check (public.crm_pipeline_visible(pipeline_id))';
    execute 'create policy crm_deals_update on public.crm_deals for update to authenticated
      using (public.crm_pipeline_visible(pipeline_id)) with check (public.crm_pipeline_visible(pipeline_id))';
    execute 'create policy crm_deals_delete on public.crm_deals for delete to authenticated
      using (public.crm_pipeline_visible(pipeline_id))';

    if to_regclass('public.crm_activities') is not null then
      execute 'drop policy if exists crm_activities_read on public.crm_activities';
      execute 'create policy crm_activities_read on public.crm_activities for select to authenticated
        using (public.crm_activity_readable(activity_space_id, deal_id, company_id, contact_id))';
    end if;

    if to_regclass('public.crm_deal_contacts') is not null then
      execute 'drop policy if exists crm_deal_contacts_visible on public.crm_deal_contacts';
      execute 'drop policy if exists crm_deal_contacts_read on public.crm_deal_contacts';
      execute 'drop policy if exists crm_deal_contacts_insert on public.crm_deal_contacts';
      execute 'drop policy if exists crm_deal_contacts_update on public.crm_deal_contacts';
      execute 'drop policy if exists crm_deal_contacts_delete on public.crm_deal_contacts';
      execute 'create policy crm_deal_contacts_read on public.crm_deal_contacts for select to authenticated
        using (public.crm_activity_readable(activity_space_id, deal_id, null::uuid, contact_id))';
      execute 'create policy crm_deal_contacts_insert on public.crm_deal_contacts for insert to authenticated
        with check (public.crm_activity_visible(activity_space_id, deal_id, null::uuid, contact_id))';
      execute 'create policy crm_deal_contacts_update on public.crm_deal_contacts for update to authenticated
        using (public.crm_activity_visible(activity_space_id, deal_id, null::uuid, contact_id))
        with check (public.crm_activity_visible(activity_space_id, deal_id, null::uuid, contact_id))';
      execute 'create policy crm_deal_contacts_delete on public.crm_deal_contacts for delete to authenticated
        using (public.crm_activity_visible(activity_space_id, deal_id, null::uuid, contact_id))';
    end if;

    if to_regclass('public.crm_element_links') is not null then
      execute 'drop policy if exists crm_element_links_read on public.crm_element_links';
      execute 'create policy crm_element_links_read on public.crm_element_links for select to authenticated
        using (public.user_can_read_element(element_id)
               and public.crm_activity_readable(activity_space_id, deal_id, company_id, contact_id))';
    end if;
  end if;

  -- ── Strategy ───────────────────────────────────────────────────────────
  if to_regprocedure('public.user_can_read_strategy(uuid)') is not null then
    execute 'drop policy if exists strategies_select_via_boundary on public.strategies';
    execute 'create policy strategies_select_via_boundary on public.strategies
      for select using (created_by = auth.uid() or public.user_can_read_strategy(id))';

    if to_regclass('public.strategy_children') is not null then
      execute 'drop policy if exists strategy_children_select_via_boundary on public.strategy_children';
      execute 'create policy strategy_children_select_via_boundary on public.strategy_children
        for select using (public.user_can_read_strategy(parent_strategy_id)
                          and public.user_can_read_strategy(child_strategy_id))';
    end if;

    execute 'drop policy if exists strategy_objects_select_via_boundary on public.strategy_objects';
    execute 'create policy strategy_objects_select_via_boundary on public.strategy_objects
      for select using (public.user_can_read_object(object_id))';
    -- Linking or unlinking an Object to an Initiative is work in that Object.
    execute 'drop policy if exists strategy_objects_insert on public.strategy_objects';
    execute 'create policy strategy_objects_insert on public.strategy_objects
      for insert
      with check (exists (select 1 from public.strategies s
                           where s.id = strategy_objects.strategy_id and s.created_by = auth.uid())
                  and public.user_can_see_object(object_id))';
    execute 'drop policy if exists strategy_objects_delete on public.strategy_objects';
    execute 'create policy strategy_objects_delete on public.strategy_objects
      for delete
      using (exists (select 1 from public.strategies s
                      where s.id = strategy_objects.strategy_id and s.created_by = auth.uid())
             and public.user_can_see_object(object_id))';

    if to_regclass('public.strategy_comments') is not null
       and to_regprocedure('public.user_can_see_strategy(uuid)') is not null then
      execute 'drop policy if exists strategy_comments_insert on public.strategy_comments';
      execute 'create policy strategy_comments_insert on public.strategy_comments
        for insert
        with check (auth.uid() is not null
                    and (author_id is null or author_id = auth.uid())
                    and public.user_can_see_strategy(strategy_id))';
    end if;

    if to_regclass('public.intents') is not null then
      execute 'drop policy if exists intents_select on public.intents';
      execute 'create policy intents_select on public.intents
        for select using (public.user_can_read_strategy(strategy_id))';
      declare
        t text;
      begin
        foreach t in array array['intent_alignments', 'intent_audits', 'intent_bindings', 'intent_escalations',
                                 'intent_lineage', 'intent_next_actions', 'intent_predictions', 'intent_resources'] loop
          if to_regclass('public.' || t) is not null then
            execute format('drop policy if exists %I on public.%I', t || '_select', t);
            execute format('create policy %I on public.%I for select
              using (exists (select 1 from public.intents i
                              where i.id = %I.intent_id and public.user_can_read_strategy(i.strategy_id)))',
              t || '_select', t, t);
          end if;
        end loop;
      end;
    end if;

    if to_regclass('public.domain_approaches') is not null then
      execute 'drop policy if exists approaches_read on public.domain_approaches';
      execute 'create policy approaches_read on public.domain_approaches
        for select to authenticated
        using (public.user_can_read_domain(domain_id) and public.user_can_read_strategy(strategy_id))';
    end if;
    if to_regclass('public.approach_contributions') is not null then
      execute 'drop policy if exists child_read on public.approach_contributions';
      execute 'create policy child_read on public.approach_contributions
        for select to authenticated
        using (exists (select 1 from public.domain_approaches a where a.id = approach_contributions.approach_id)
               and public.user_can_read_object(object_id))';
    end if;
  end if;

  -- ── Widgets and boards ─────────────────────────────────────────────────
  if to_regprocedure('public.user_can_read_widget_subject(text, uuid)') is not null
     and to_regprocedure('public.user_can_see_widget_subject(text, uuid)') is not null then
    if to_regclass('public.boards') is not null then
      execute 'drop policy if exists boards_select on public.boards';
      execute 'create policy boards_select on public.boards
        for select to authenticated using (public.user_can_read_widget_subject(subject_kind, subject_id))';
    end if;
    if to_regclass('public.board_placements') is not null and to_regclass('public.boards') is not null then
      execute 'drop policy if exists board_placements_insert on public.board_placements';
      execute 'create policy board_placements_insert on public.board_placements
        for insert to authenticated
        with check (exists (select 1 from public.boards b
                             where b.id = board_placements.board_id
                               and public.user_can_see_widget_subject(b.subject_kind, b.subject_id))
                    and exists (select 1 from public.widgets w where w.id = board_placements.widget_id))';
      execute 'drop policy if exists board_placements_update on public.board_placements';
      execute 'create policy board_placements_update on public.board_placements
        for update to authenticated
        using (exists (select 1 from public.boards b
                        where b.id = board_placements.board_id
                          and public.user_can_see_widget_subject(b.subject_kind, b.subject_id)))
        with check (exists (select 1 from public.boards b
                             where b.id = board_placements.board_id
                               and public.user_can_see_widget_subject(b.subject_kind, b.subject_id)))';
      execute 'drop policy if exists board_placements_delete on public.board_placements';
      execute 'create policy board_placements_delete on public.board_placements
        for delete to authenticated
        using (exists (select 1 from public.boards b
                        where b.id = board_placements.board_id
                          and public.user_can_see_widget_subject(b.subject_kind, b.subject_id))
               and exists (select 1 from public.widgets w where w.id = board_placements.widget_id))';
    end if;
    if to_regclass('public.widgets') is not null then
      execute 'drop policy if exists widgets_by_origin on public.widgets';
      execute 'drop policy if exists widgets_select on public.widgets';
      execute 'drop policy if exists widgets_insert on public.widgets';
      execute 'drop policy if exists widgets_update on public.widgets';
      execute 'drop policy if exists widgets_delete on public.widgets';
      execute 'create policy widgets_select on public.widgets for select to authenticated
        using (public.user_can_read_widget_subject(origin_kind, origin_id))';
      execute 'create policy widgets_insert on public.widgets for insert to authenticated
        with check (public.user_can_see_widget_subject(origin_kind, origin_id))';
      execute 'create policy widgets_update on public.widgets for update to authenticated
        using (public.user_can_see_widget_subject(origin_kind, origin_id))
        with check (public.user_can_see_widget_subject(origin_kind, origin_id))';
      execute 'create policy widgets_delete on public.widgets for delete to authenticated
        using (public.user_can_see_widget_subject(origin_kind, origin_id))';
    end if;
    if to_regclass('public.widget_documents') is not null and to_regclass('public.widgets') is not null then
      execute 'drop policy if exists widget_documents_by_widget on public.widget_documents';
      execute 'drop policy if exists widget_documents_select on public.widget_documents';
      execute 'drop policy if exists widget_documents_insert on public.widget_documents';
      execute 'drop policy if exists widget_documents_update on public.widget_documents';
      execute 'drop policy if exists widget_documents_delete on public.widget_documents';
      execute 'create policy widget_documents_select on public.widget_documents for select to authenticated
        using (exists (select 1 from public.widgets w where w.id = widget_documents.widget_id))';
      execute 'create policy widget_documents_insert on public.widget_documents for insert to authenticated
        with check (exists (select 1 from public.widgets w where w.id = widget_documents.widget_id
                             and public.user_can_see_widget_subject(w.origin_kind, w.origin_id)))';
      execute 'create policy widget_documents_update on public.widget_documents for update to authenticated
        using (exists (select 1 from public.widgets w where w.id = widget_documents.widget_id
                        and public.user_can_see_widget_subject(w.origin_kind, w.origin_id)))
        with check (exists (select 1 from public.widgets w where w.id = widget_documents.widget_id
                             and public.user_can_see_widget_subject(w.origin_kind, w.origin_id)))';
      execute 'create policy widget_documents_delete on public.widget_documents for delete to authenticated
        using (exists (select 1 from public.widgets w where w.id = widget_documents.widget_id
                        and public.user_can_see_widget_subject(w.origin_kind, w.origin_id)))';
    end if;
  end if;

  -- ── Invitations carry a role ───────────────────────────────────────────
  if to_regclass('public.membership_invitations') is not null
     and to_regprocedure('public.invite_member(text, uuid, uuid)') is not null
     and to_regprocedure('alcon_internal.user_manages_scope_as(uuid, text, uuid)') is not null then
    execute 'alter table public.membership_invitations drop constraint if exists membership_invitations_role_check';
    execute $ddl$alter table public.membership_invitations add constraint membership_invitations_role_check
      check (role in ('member', 'viewer') and (role = 'member' or domain_id is not null))$ddl$;

    execute 'drop function public.invite_member(text, uuid, uuid)';
    execute $f$
      create function public.invite_member(p_scope text, p_scope_id uuid, p_user uuid, p_role text default 'member')
      returns uuid language plpgsql security definer set search_path = '' as $b$
      declare
        v_actor uuid := auth.uid();
        v_role text := coalesce(p_role, 'member');
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
        if v_role not in ('member', 'viewer') or (v_role = 'viewer' and p_scope <> 'domain') then
          raise exception 'Invite to a Domain as a member or a viewer, and to a Space or Object as a member'
            using errcode = '22023';
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
        -- A Space member already works in the Space's workspace Domains; a
        -- viewer invitation would read as a restriction it is not.
        if v_role = 'viewer' and exists (
             select 1 from public.domains d
               join public.activity_space_members m on m.activity_space_id = d.activity_space_id
              where d.id = p_scope_id and d.privacy = 'workspace' and m.user_id = p_user) then
          raise exception 'This person already works in this Domain as a member of its Space. Invite them as a member, or change their role in the Domain''s member list.'
            using errcode = '22023', hint = 'alcon:viewer_reaches_through_space';
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
          (activity_space_id, domain_id, object_id, invitee_id, invited_by, role, scope_name, inviter_name)
        values (
          case when p_scope = 'space' then p_scope_id end,
          case when p_scope = 'domain' then p_scope_id end,
          case when p_scope = 'object' then p_scope_id end,
          p_user, v_actor, v_role, coalesce(v_scope_name, ''), v_inviter_name)
        returning id into v_id;

        insert into public.notifications (recipient_id, actor_id, actor_name, kind, invitation_id, title, body)
        values (
          p_user, v_actor, v_inviter_name, 'invite', v_id,
          coalesce(v_inviter_name, 'Someone') || ' invited you to '
            || case when v_role = 'viewer' then 'view ' else '' end
            || v_label || ' ' || coalesce(v_scope_name, ''),
          case when v_role = 'viewer'
            then 'You join as a viewer when you accept: you can read everything in it and change nothing. Until then nothing in it is shared with you.'
            else 'You join when you accept. Until then you are not a member and nothing in it is shared with you.' end);

        return v_id;
      end
      $b$
    $f$;
    execute 'revoke all on function public.invite_member(text, uuid, uuid, text) from public, anon';
    execute 'grant execute on function public.invite_member(text, uuid, uuid, text) to authenticated, service_role';
  end if;

  if to_regprocedure('public.respond_to_invite(uuid, boolean)') is not null
     and to_regclass('public.membership_invitations') is not null then
    execute $f$
      create or replace function public.respond_to_invite(p_invitation uuid, p_accept boolean)
      returns text language plpgsql security definer set search_path = '' as $b$
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
            values (v.domain_id, v.invitee_id,
                    case when v.role = 'viewer' then 'viewer' else 'member' end)
            on conflict do nothing;
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
  end if;

  -- ── Changing a Domain member's role ────────────────────────────────────
  if to_regprocedure('alcon_internal.user_manages_scope_as(uuid, text, uuid)') is not null then
    execute $f$
      create or replace function public.set_domain_member_role(p_domain uuid, p_user uuid, p_role text)
      returns text language plpgsql security definer set search_path = '' as $b$
      declare
        v_actor uuid := auth.uid();
        v_current text;
      begin
        if v_actor is null then
          raise exception 'Sign in to change roles' using errcode = '42501';
        end if;
        if p_domain is null or p_user is null or p_role is null
           or p_role not in ('owner', 'admin', 'member', 'viewer') then
          raise exception 'Choose a person and a role: owner, admin, member or viewer' using errcode = '22023';
        end if;
        if not alcon_internal.user_manages_scope_as(v_actor, 'domain', p_domain) then
          raise exception 'Only owners and admins of this Domain can change roles' using errcode = '42501';
        end if;
        select dm.role into v_current from public.domain_members dm
         where dm.domain_id = p_domain and dm.user_id = p_user
         for update;
        if not found then
          raise exception 'This person is not a member of this Domain' using errcode = 'P0002';
        end if;
        if v_current = p_role then
          return v_current;
        end if;
        if (p_role = 'owner' or v_current = 'owner') and not exists (
             select 1 from public.domain_members dm
              where dm.domain_id = p_domain and dm.user_id = v_actor and dm.role = 'owner') then
          raise exception 'Only an owner of this Domain can grant or change ownership' using errcode = '42501';
        end if;
        -- domain_members_guard_last_owner refuses to demote the last owner.
        update public.domain_members set role = p_role
         where domain_id = p_domain and user_id = p_user;
        return p_role;
      end
      $b$
    $f$;
    execute 'revoke all on function public.set_domain_member_role(uuid, uuid, text) from public, anon';
    execute 'grant execute on function public.set_domain_member_role(uuid, uuid, text) to authenticated, service_role';
  end if;
end
$mig$;

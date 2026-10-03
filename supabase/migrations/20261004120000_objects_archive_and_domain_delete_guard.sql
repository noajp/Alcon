-- Objects no longer in use are archived; a Domain that still has Objects
-- cannot be deleted (Domain → Object → Element).
--
-- Archive
--   objects.archived_at / archived_by. An archived Object keeps all its data,
--   stays readable by id (direct links, search, Element detail) and drops out
--   of everything a user browses or picks from: get_explorer_data (unless the
--   caller asks for that one Object by id), get_now_work, get_my_elements and
--   the due-soon notifications. An Element whose home Objects are all archived
--   counts as archived work (alcon_internal.element_in_archived_work).
--
--   Only whoever manages the Object may archive or restore it
--   (alcon_internal.user_manages_object: owner/admin of its primary Domain, or
--   of the Object itself while it has no Domain). The rule lives in one BEFORE
--   UPDATE trigger so every write path (browser, MCP, agents) meets it; the
--   server stamps archived_at / archived_by. The objects UPDATE policy admits
--   only Object members, and a Domain owner/admin need not be one, so
--   archive_object / restore_object (SECURITY DEFINER) are the path the app
--   uses; the same trigger checks them.
--
-- Domain delete
--   A BEFORE DELETE trigger on domains refuses while any Object (archived ones
--   included) has domain_id = the Domain. Space deletion only clears
--   domains.activity_space_id, so it is unaffected. Deleting an account whose
--   user created the Domain cascades into this delete and is refused the same
--   way: move the Objects first.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.objects') is null
     or to_regclass('public.domains') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.element_objects') is null
     or to_regprocedure('alcon_internal.user_manages_object(uuid)') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null
     or to_regprocedure('public.get_explorer_data(uuid)') is null
     or to_regprocedure('public.get_now_work(uuid)') is null
     or to_regprocedure('public.get_my_elements()') is null
     or to_regprocedure('public.generate_due_soon_notifications()') is null then
    raise notice 'objects_archive_and_domain_delete_guard skipped: base schema not present';
    return;
  end if;

  -- ── Columns ───────────────────────────────────────────────────────────
  execute 'alter table public.objects add column if not exists archived_at timestamptz';
  execute 'alter table public.objects add column if not exists archived_by uuid references auth.users(id) on delete set null';
  execute 'create index if not exists objects_active_domain_idx on public.objects (domain_id) where archived_at is null';

  -- ── Who may archive / restore ─────────────────────────────────────────
  execute $f$
    create or replace function alcon_internal.objects_archive_guard()
    returns trigger language plpgsql security definer set search_path = ''
    as $b$
    begin
      if auth.uid() is null then
        return new;
      end if;
      if new.archived_at is not distinct from old.archived_at then
        -- Only archiving writes archived_by.
        new.archived_by := old.archived_by;
        return new;
      end if;
      if not alcon_internal.user_manages_object(old.id) then
        raise exception 'Only owners or admins of this Object''s Domain can archive or restore it'
          using errcode = '42501';
      end if;
      if new.archived_at is null then
        new.archived_by := null;
      elsif old.archived_at is null then
        new.archived_at := now();
        new.archived_by := auth.uid();
      else
        new.archived_at := old.archived_at;
        new.archived_by := old.archived_by;
      end if;
      return new;
    end
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.objects_archive_guard() from public, anon, authenticated';
  execute 'drop trigger if exists objects_archive_guard on public.objects';
  execute 'create trigger objects_archive_guard before update on public.objects
    for each row execute function alcon_internal.objects_archive_guard()';

  execute $f$
    create or replace function public.archive_object(p_object uuid)
    returns timestamptz language plpgsql security definer set search_path = ''
    as $b$
    declare
      v_at timestamptz;
    begin
      if auth.uid() is null then
        raise exception 'Sign in to archive an Object' using errcode = '42501';
      end if;
      if not public.user_can_see_object(p_object) then
        raise exception 'Object not found' using errcode = 'P0002';
      end if;
      if not alcon_internal.user_manages_object(p_object) then
        raise exception 'Only owners or admins of this Object''s Domain can archive or restore it'
          using errcode = '42501';
      end if;
      update public.objects set archived_at = coalesce(archived_at, now())
       where id = p_object
      returning archived_at into v_at;
      return v_at;
    end
    $b$
  $f$;

  execute $f$
    create or replace function public.restore_object(p_object uuid)
    returns void language plpgsql security definer set search_path = ''
    as $b$
    begin
      if auth.uid() is null then
        raise exception 'Sign in to restore an Object' using errcode = '42501';
      end if;
      if not public.user_can_see_object(p_object) then
        raise exception 'Object not found' using errcode = 'P0002';
      end if;
      if not alcon_internal.user_manages_object(p_object) then
        raise exception 'Only owners or admins of this Object''s Domain can archive or restore it'
          using errcode = '42501';
      end if;
      update public.objects set archived_at = null where id = p_object;
    end
    $b$
  $f$;
  execute 'revoke all on function public.archive_object(uuid) from public, anon';
  execute 'revoke all on function public.restore_object(uuid) from public, anon';
  execute 'grant execute on function public.archive_object(uuid) to authenticated, service_role';
  execute 'grant execute on function public.restore_object(uuid) to authenticated, service_role';

  -- ── Archived work ─────────────────────────────────────────────────────
  -- An Element is archived work when it has home Objects and every one of
  -- them is archived. Personal and Domain-direct Elements never are.
  execute $f$
    create or replace function alcon_internal.element_in_archived_work(p_element uuid)
    returns boolean language sql stable security definer set search_path = ''
    as $b$
      with homes as (
        select o.archived_at from public.elements e
          join public.objects o on o.id = e.object_id
         where e.id = p_element
        union all
        select o.archived_at from public.element_objects eo
          join public.objects o on o.id = eo.object_id
         where eo.element_id = p_element
      )
      select exists (select 1 from homes)
         and not exists (select 1 from homes where archived_at is null)
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.element_in_archived_work(uuid) from public, anon';
  execute 'grant execute on function alcon_internal.element_in_archived_work(uuid) to authenticated, service_role';

  -- ── Explorer: active Objects; one Object by id (archived or not) ───────
  execute 'drop function if exists public.get_explorer_data(uuid)';
  execute $f$
    create or replace function public.get_explorer_data(p_domain_id uuid default null, p_object_id uuid default null)
    returns jsonb language sql stable set search_path to 'public'
    as $b$
    with
    scoped_objects as (
      select o.*
      from objects o
      where public.user_can_see_object(o.id)
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
    $b$
  $f$;
  execute 'grant execute on function public.get_explorer_data(uuid, uuid) to authenticated, service_role';

  -- ── Now: active Objects only ──────────────────────────────────────────
  execute $f$
    create or replace function public.get_now_work(p_space_id uuid)
    returns jsonb language plpgsql stable security definer set search_path to ''
    as $b$
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
      where public.user_can_see_object(o.id)
        and o.archived_at is null
        and (exists (select 1 from public.domains d where d.id=o.domain_id and d.activity_space_id=p_space_id)
          or exists (select 1 from public.object_domains od join public.domains d on d.id=od.domain_id
            where od.object_id=o.id and d.activity_space_id=p_space_id));
      select coalesce(array_agg(e.id), '{}') into v_elements from public.elements e
      where public.user_can_see_element(e.id)
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
            and public.user_can_see_domain(d.id)) then o.domain_id else null end) order by o.id)
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
    $b$
  $f$;

  -- ── My Elements: no archived work; home Objects are the active ones ────
  execute $f$
    create or replace function public.get_my_elements()
    returns jsonb language sql stable set search_path to 'public'
    as $b$
    with
    my_workers as (
      select w.* from workers w where w.user_id = auth.uid()
    ),
    mine as (
      select m.* from (
        select e.* from elements e where e.owner_id = auth.uid()
        union
        select e.* from elements e
         where e.id in (
           select ea.element_id from element_assignees ea
            where ea.worker_id in (select id from my_workers)
         )
      ) m
      where not alcon_internal.element_in_archived_work(m.id)
    ),
    enriched as (
      select
        e.order_index,
        to_jsonb(e.*) || jsonb_build_object(
          'subelements', coalesce((
            select jsonb_agg(to_jsonb(s.*) order by s.order_index)
              from subelements s where s.element_id = e.id
          ), '[]'::jsonb),
          'assignees', coalesce((
            select jsonb_agg(to_jsonb(a.*) || jsonb_build_object('worker', to_jsonb(w.*)))
              from element_assignees a
              left join workers w on w.id = a.worker_id
             where a.element_id = e.id
          ), '[]'::jsonb),
          'objectIds', homes.ids,
          'isMultiHomed', jsonb_array_length(homes.ids) > 1,
          'objects', homes.objs
        ) as obj
      from mine e
      cross join lateral (
        -- Home Objects: the multi-home junction ∪ the primary object_id,
        -- primary first. Objects hidden by RLS and archived Objects drop out.
        select
          coalesce(jsonb_agg(o.id order by (o.id = e.object_id) desc, o.name), '[]'::jsonb) as ids,
          coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name)
                             order by (o.id = e.object_id) desc, o.name), '[]'::jsonb) as objs
        from (
          select e.object_id as id where e.object_id is not null
          union
          select eo.object_id from element_objects eo where eo.element_id = e.id
        ) h
        join objects o on o.id = h.id and o.archived_at is null
      ) homes
    )
    select jsonb_build_object(
      'workers', coalesce((select jsonb_agg(to_jsonb(w.*)) from my_workers w), '[]'::jsonb),
      'elements', coalesce((
        select jsonb_agg(en.obj order by en.order_index nulls last) from enriched en
      ), '[]'::jsonb)
    );
    $b$
  $f$;

  -- ── Due-soon notifications skip archived work ─────────────────────────
  execute $f$
    create or replace function public.generate_due_soon_notifications()
    returns void language plpgsql security definer set search_path to 'public', 'pg_catalog'
    as $b$
    begin
      insert into notifications (recipient_id, kind, element_id, title, body)
      select c.recipient_id, 'due_soon', c.element_id, c.title, c.body
      from (
        select distinct
          e.id as element_id,
          w.user_id as recipient_id,
          coalesce(e.title, 'Untitled') || ' is due ' || to_char(e.due_date, 'YYYY-MM-DD') as title,
          'Due ' || to_char(e.due_date, 'YYYY-MM-DD') as body
        from elements e
        join objects o on o.id = e.object_id
        join domains d on d.id = o.domain_id
        join lateral (
          select case
            when jsonb_typeof(d.risk_thresholds -> 'due_soon_days') = 'number'
                 and (d.risk_thresholds ->> 'due_soon_days')::numeric > 0
                 and (d.risk_thresholds ->> 'due_soon_days')::numeric <= 3650
            then (d.risk_thresholds ->> 'due_soon_days')::numeric
            else 3
          end as due_soon_days
        ) t on true
        join element_assignees ea on ea.element_id = e.id
        join workers w on w.id = ea.worker_id
        where w.user_id is not null
          and e.status in ('backlog', 'todo')
          and e.due_date is not null
          and e.due_date >= current_date
          and e.due_date <= current_date + make_interval(days => t.due_soon_days::int)
          and not alcon_internal.element_in_archived_work(e.id)
          and alcon_internal.user_can_see_element_as(e.id, w.user_id)
      ) c
      where c.body is distinct from (
        select n.body
        from notifications n
        where n.element_id = c.element_id
          and n.recipient_id = c.recipient_id
          and n.kind = 'due_soon'
        order by n.created_at desc
        limit 1
      );
    end
    $b$
  $f$;

  -- ── A Domain with Objects cannot be deleted ───────────────────────────
  execute $f$
    create or replace function alcon_internal.domains_delete_guard()
    returns trigger language plpgsql security definer set search_path = ''
    as $b$
    declare
      v_count integer;
    begin
      select count(*) into v_count from public.objects where domain_id = old.id;
      if v_count > 0 then
        raise exception 'This Domain still has % Objects, including archived ones. Move them to another Domain or delete them first', v_count
          using errcode = '23503', hint = 'domain_has_objects', detail = v_count::text;
      end if;
      return old;
    end
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.domains_delete_guard() from public, anon, authenticated';
  execute 'drop trigger if exists domains_delete_guard on public.domains';
  execute 'create trigger domains_delete_guard before delete on public.domains
    for each row execute function alcon_internal.domains_delete_guard()';
end $$;

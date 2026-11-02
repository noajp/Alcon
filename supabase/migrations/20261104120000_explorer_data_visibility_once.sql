-- get_explorer_data ran as the caller, so row-level security asked the
-- nested visibility helpers (user_can_read_element → _object → _domain → …)
-- on every row of every table the JSON reads — elements, element_objects
-- twice, subelements, assignees, workers — 400 ms on average for 58
-- Elements, and every screen waits on it (ELE_OBJ-010).
--
-- It now runs as definer and asks user_can_read_object once per Object;
-- Elements, links, sub-elements, assignees and workers are filtered by the
-- same rules their SELECT policies state, restated against that set. The
-- output is unchanged (compared for every user × every Domain / Object
-- argument before applying); it is about ten times faster.
do $mig$
begin
  if to_regclass('public.objects') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.element_objects') is null
     or to_regclass('public.workers') is null
     or to_regprocedure('public.user_can_read_object(uuid)') is null
     or to_regprocedure('public.user_can_read_domain(uuid)') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('alcon_internal.user_can_see_worker(uuid)') is null then
    raise notice 'explorer_data_visibility_once skipped: base schema not present'; return;
  end if;

  execute $ddl$
create or replace function public.get_explorer_data(p_domain_id uuid default null, p_object_id uuid default null)
returns jsonb language sql stable security definer set search_path = public as $fn$
    with
    -- Visibility is asked once per Object and once per Element here, instead
    -- of by row-level security on every row of every table the JSON reads.
    -- The function is security definer, so each filter below restates the
    -- SELECT policy of its table (elements, element_objects, subelements,
    -- element_assignees, workers).
    vis_objects as (
      select o.id from public.objects o where public.user_can_read_object(o.id)
    ),
    scoped_objects as (
      select o.*
      from public.objects o
      join vis_objects v on v.id = o.id
      where case
              when p_object_id is not null then o.id = p_object_id
              else o.archived_at is null
                   and (
                     p_domain_id is null
                     or o.domain_id = p_domain_id
                     -- object_domains' SELECT policy: the Domain must be readable.
                     or (public.user_can_read_domain(p_domain_id) and exists (
                          select 1 from public.object_domains od
                          where od.object_id = o.id and od.domain_id = p_domain_id
                        ))
                   )
            end
    ),
    -- elements' SELECT policy, for rows with no owner (the only ones listed).
    base_elements as (
      select e.* from public.elements e
      where e.owner_id is null
        and (
          (e.object_id is not null and e.object_id in (select id from vis_objects))
          or exists (select 1 from public.element_objects eo
                      where eo.element_id = e.id and eo.object_id in (select id from vis_objects))
          or (e.object_id is null
              and not exists (select 1 from public.element_objects eo where eo.element_id = e.id))
        )
    ),
    -- user_can_read_element for every Element: owned by me, or as above.
    readable_elements as (
      select e.id from public.elements e
      where e.owner_id = (select auth.uid())
         or (e.object_id is not null and e.object_id in (select id from vis_objects))
         or exists (select 1 from public.element_objects eo
                     where eo.element_id = e.id and eo.object_id in (select id from vis_objects))
         or (e.object_id is null and e.owner_id is null
             and not exists (select 1 from public.element_objects eo where eo.element_id = e.id))
    ),
    -- element_objects' SELECT policy.
    vis_links as (
      select eo.* from public.element_objects eo
      where eo.object_id in (select id from vis_objects)
        and eo.element_id in (select id from readable_elements)
    ),
    elem_objids as (
      select be.id as element_id,
             coalesce(
               (select array_agg(eo.object_id order by eo.order_index, be.seq_number)
                  from vis_links eo where eo.element_id = be.id),
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
                                  from public.subelements s where s.element_id = be.id), '[]'::jsonb),
                    'assignees',
                      coalesce((select jsonb_agg(
                                  to_jsonb(a.*)
                                  || jsonb_build_object('worker',
                                       (select to_jsonb(w.*) from public.workers w
                                         where w.id = a.worker_id
                                           -- workers' SELECT policy
                                           and (w.user_id = (select auth.uid())
                                                or (w.user_id is null and w.object_id is null and w.activity_space_id is not null
                                                    and public.is_activity_space_member(w.activity_space_id))
                                                or (w.user_id is null and w.object_id is not null
                                                    and w.object_id in (select id from vis_objects))
                                                or alcon_internal.user_can_see_worker(w.id)))))
                                  from public.element_assignees a where a.element_id = be.id), '[]'::jsonb),
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
                 from vis_links eo
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
           and not exists (select 1 from vis_links eo where eo.element_id = en.id)
      ), '[]'::jsonb) end
    );
$fn$
  $ddl$;
  execute 'revoke all on function public.get_explorer_data(uuid, uuid) from public, anon';
  execute 'grant execute on function public.get_explorer_data(uuid, uuid) to authenticated, service_role';
end $mig$;

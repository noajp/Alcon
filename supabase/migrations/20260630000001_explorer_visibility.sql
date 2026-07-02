-- Align get_explorer_data with the boundary model (P2).
--
-- The RPC previously gated Objects by object_members ONLY, so a Space member
-- could not see Objects in a 'workspace'-public Domain unless explicitly added
-- as an object_member. Swap that single filter for user_can_see_object(), so
-- visibility matches the RLS policies added in boundary_rls:
--   object_member OR any of its Domains visible (workspace+Space-member, or
--   domain_member). Everything else in the function is unchanged.
--
-- The function is SECURITY INVOKER, so RLS still applies to every table it
-- reads. Wrapped in a DO/EXECUTE guard because a LANGUAGE sql body is parsed
-- against the catalog at CREATE time — on an empty preview replay the base
-- tables are absent, so we skip.

do $mig$
begin
  if to_regclass('public.objects') is null
     or to_regclass('public.elements') is null then
    raise notice 'explorer visibility skipped: base tables absent (preview replay?)';
    return;
  end if;

  execute $fn$
    create or replace function public.get_explorer_data(p_domain_id uuid default null::uuid)
    returns jsonb
    language sql
    stable
    set search_path to 'public'
    as $body$
    with
    scoped_objects as (
      select o.*
      from objects o
      where public.user_can_see_object(o.id)
        and (
              p_domain_id is null
              or o.domain_id = p_domain_id
              or exists (
                   select 1 from object_domains od
                   where od.object_id = o.id and od.domain_id = p_domain_id
                 )
            )
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
      'rootElements', coalesce((
        select jsonb_agg(en.obj order by en.order_index nulls last, en.seq_number nulls last)
          from enriched en
         where en.object_id is null
           and not exists (select 1 from element_objects eo where eo.element_id = en.id)
      ), '[]'::jsonb)
    );
    $body$;
  $fn$;
end
$mig$;

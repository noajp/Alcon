-- One round trip for the My Elements surface.
--
-- The client assembled "Elements I own or am assigned to" from a seven-step
-- sequential waterfall (my workers → my assignee rows → owned elements →
-- assigned elements → subelements/assignees/element_objects → assignee
-- workers → object names). It is the landing view, so that waterfall was most
-- of what a user waited on after the shell painted. get_my_elements() builds
-- the same ElementWithDetails shape in Postgres, mirroring get_explorer_data.
--
-- SECURITY INVOKER: every table read is still filtered by RLS as the caller,
-- and the caller is taken from auth.uid() — no argument can widen the scope.
-- Wrapped in a DO/EXECUTE guard because a LANGUAGE sql body is parsed
-- against the catalog at CREATE time — on an empty preview replay the base
-- tables are absent, so we skip.

do $mig$
begin
  if to_regclass('public.elements') is null
     or to_regclass('public.workers') is null
     or to_regclass('public.element_assignees') is null then
    raise notice 'get_my_elements skipped: base tables absent (preview replay?)';
    return;
  end if;

  execute $fn$
    create or replace function public.get_my_elements()
    returns jsonb
    language sql
    stable
    set search_path to 'public'
    as $body$
    with
    my_workers as (
      select w.* from workers w where w.user_id = auth.uid()
    ),
    mine as (
      select e.* from elements e where e.owner_id = auth.uid()
      union
      select e.* from elements e
       where e.id in (
         select ea.element_id from element_assignees ea
          where ea.worker_id in (select id from my_workers)
       )
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
        -- Home Objects: the multi-home junction ∪ the legacy primary
        -- object_id, primary first. Objects hidden by RLS drop out of the
        -- join, matching the client's old "keep only named objects" filter.
        select
          coalesce(jsonb_agg(o.id order by (o.id = e.object_id) desc, o.name), '[]'::jsonb) as ids,
          coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name)
                             order by (o.id = e.object_id) desc, o.name), '[]'::jsonb) as objs
        from (
          select e.object_id as id where e.object_id is not null
          union
          select eo.object_id from element_objects eo where eo.element_id = e.id
        ) h
        join objects o on o.id = h.id
      ) homes
    )
    select jsonb_build_object(
      'workers', coalesce((select jsonb_agg(to_jsonb(w.*)) from my_workers w), '[]'::jsonb),
      'elements', coalesce((
        select jsonb_agg(en.obj order by en.order_index nulls last) from enriched en
      ), '[]'::jsonb)
    );
    $body$;
  $fn$;
end
$mig$;

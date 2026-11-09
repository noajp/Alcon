-- A found file names its Element quotably: space_attachments and
-- search_attachments both gain the host Element's display_id
-- (ELE_OBJ-017), so a search result — ⌘K's line, the Files pane's
-- "where it is attached", Athena's searchFiles — cites the id a person
-- would quote, not only the Element's title. One column wider on the
-- one search path; the matching itself is untouched, and the column
-- rides at the end of each projection so existing readers keep their
-- shape. search_attachments reads space_attachments, so both are
-- recreated (the remove_portfolio pattern).
do $$
begin
  if to_regclass('public.attachments') is null or to_regclass('public.elements') is null or to_regclass('public.objects') is null
     or to_regclass('public.domains') is null or to_regclass('public.strategies') is null or to_regclass('public.folders') is null
     or to_regclass('public.attachment_texts') is null then
    raise notice 'attachment_display_id skipped: a table these functions read is not present'; return;
  end if;

  execute 'drop function if exists public.search_attachments(uuid, text, integer)';
  execute 'drop function if exists public.space_attachments(uuid)';
  execute 'drop function if exists public.space_attachments(uuid, boolean)';
  execute $f$
    create function public.space_attachments(p_space uuid, p_trashed boolean default false)
    returns table(id uuid, path text, name text, size bigint, mime_type text, uploaded_by uuid,
      created_at timestamptz, deleted_at timestamptz, previous_id uuid, element_id uuid, object_id uuid,
      strategy_id uuid, folder_id uuid, owner_label text, element_object_id uuid,
      domain_id uuid, versions integer, element_display_id text)
    language sql stable set search_path to 'public' as $b$
      with recursive chain as (
        select a.id, a.id as root from attachments a where a.previous_id is null
        union all
        select a.id, c.root from attachments a join chain c on a.previous_id = c.id
      ),
      counts as (select root, count(*)::int as n from chain group by root),
      heads as (
        select a.* from attachments a
        where (a.deleted_at is not null) = p_trashed
          and (not p_trashed or a.deleted_at > now() - interval '30 days')
          and not exists (select 1 from attachments n where n.previous_id = a.id)
      )
      select h.id, h.path, h.name, h.size, h.mime_type, h.uploaded_by, h.created_at, h.deleted_at, h.previous_id,
        h.element_id, h.object_id, h.strategy_id, h.folder_id,
        coalesce(e.title, ob.name, s.name, fo.name) as owner_label,
        e.object_id as element_object_id,
        coalesce(eo.domain_id, ob.domain_id, fo.domain_id) as domain_id,
        coalesce(ct.n, 1) as versions,
        e.display_id as element_display_id
      from heads h
      left join chain ch on ch.id = h.id
      left join counts ct on ct.root = ch.root
      left join elements e on e.id = h.element_id
      left join objects eo on eo.id = e.object_id
      left join objects ob on ob.id = h.object_id
      left join domains d on d.id = coalesce(eo.domain_id, ob.domain_id)
      left join strategies s on s.id = h.strategy_id
      left join folders fo on fo.id = h.folder_id
      where coalesce(d.activity_space_id, s.activity_space_id, fo.activity_space_id) = p_space
      order by coalesce(h.deleted_at, h.created_at) desc
    $b$
  $f$;
  execute 'grant execute on function public.space_attachments(uuid, boolean) to authenticated, service_role';

  execute $f$
    create function public.search_attachments(p_space uuid, p_query text, p_limit integer default 20)
    returns table (id uuid, name text, mime_type text, element_id uuid, object_id uuid, strategy_id uuid,
      folder_id uuid, owner_label text, element_object_id uuid, domain_id uuid, snippet text, element_display_id text)
    language sql stable set search_path = public as $body$
      with q as (select '%' || replace(replace(replace(p_query, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' as pattern)
      select s.id, s.name, s.mime_type, s.element_id, s.object_id, s.strategy_id, s.folder_id,
        s.owner_label, s.element_object_id, s.domain_id,
        case when x.pos > 0 then
          (case when x.pos > 40 then '…' else '' end)
          || regexp_replace(substr(t.body, greatest(1, x.pos - 40), 140), '\\s+', ' ', 'g')
          || (case when length(t.body) > x.pos + 100 then '…' else '' end)
        end as snippet,
        s.element_display_id
      from public.space_attachments(p_space) s
      cross join q
      left join public.attachment_texts t on t.attachment_id = s.id
      cross join lateral (select coalesce(strpos(lower(t.body), lower(p_query)), 0) as pos) x
      where length(trim(p_query)) > 0
        and (s.name ilike q.pattern or s.owner_label ilike q.pattern or t.body ilike q.pattern)
      order by (s.name ilike q.pattern) desc, s.created_at desc
      limit greatest(1, least(p_limit, 50))
    $body$
  $f$;
  execute 'grant execute on function public.search_attachments(uuid, text, integer) to authenticated, service_role';
end $$;

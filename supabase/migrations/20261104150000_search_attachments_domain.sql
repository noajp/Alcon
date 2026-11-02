-- A file found by search says which Domain it sits in (through its Element,
-- Object or folder, as space_attachments reads it), so opening what it is
-- attached to opens that Domain too — an Object of APL_Div no longer shows
-- under the Domain that happened to be open.
do $$
begin
  if to_regclass('public.attachments') is null or to_regclass('public.attachment_texts') is null then
    raise notice 'search_attachments skipped: a table it reads is not present'; return;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'space_attachments') then
    raise notice 'search_attachments skipped: space_attachments is not present'; return;
  end if;
  execute 'drop function if exists public.search_attachments(uuid, text, integer)';
  execute $f$
    create or replace function public.search_attachments(p_space uuid, p_query text, p_limit integer default 20)
    returns table (id uuid, name text, mime_type text, element_id uuid, object_id uuid, strategy_id uuid, portfolio_id uuid,
      deal_id uuid, company_id uuid, folder_id uuid, owner_label text, element_object_id uuid, domain_id uuid, snippet text)
    language sql stable set search_path = public as $body$
      with q as (select '%' || replace(replace(replace(p_query, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' as pattern)
      select s.id, s.name, s.mime_type, s.element_id, s.object_id, s.strategy_id, s.portfolio_id, s.deal_id, s.company_id, s.folder_id,
        s.owner_label, s.element_object_id, s.domain_id,
        case when x.pos > 0 then
          (case when x.pos > 40 then '…' else '' end)
          || regexp_replace(substr(t.body, greatest(1, x.pos - 40), 140), '\\s+', ' ', 'g')
          || (case when length(t.body) > x.pos + 100 then '…' else '' end)
        end as snippet
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
  execute 'grant execute on function public.search_attachments(uuid, text, integer) to authenticated';
end $$;

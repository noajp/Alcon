-- What an attached file says, so it can be found by its words: the text
-- the browser takes out of each file (Word, Excel, PowerPoint, PDF, text —
-- the same deterministic readers as the preview, no service and no AI),
-- one row per version, seen by whoever can see the file. Search matches a
-- file's name, what it is attached to and its text, and returns the words
-- around the match.
do $$
begin
  if to_regclass('public.attachments') is null then
    raise notice 'attachment_texts skipped: attachments not present'; return;
  end if;

  execute 'create table if not exists public.attachment_texts (
    attachment_id uuid primary key references public.attachments(id) on delete cascade,
    body text not null,
    extracted_at timestamptz not null default now()
  )';
  execute 'alter table public.attachment_texts enable row level security';
  execute 'drop policy if exists "attachment texts visible" on public.attachment_texts';
  execute 'create policy "attachment texts visible" on public.attachment_texts for all to authenticated
    using (exists (select 1 from public.attachments a where a.id = attachment_texts.attachment_id))
    with check (exists (select 1 from public.attachments a where a.id = attachment_texts.attachment_id))';
  execute 'grant select, insert, update on public.attachment_texts to authenticated';

  -- Substring search (Japanese has no spaces to split words on): trigrams.
  execute 'create extension if not exists pg_trgm with schema extensions';
  execute 'create index if not exists attachment_texts_body_trgm on public.attachment_texts using gin (body extensions.gin_trgm_ops)';

  if to_regprocedure('public.space_attachments(uuid,boolean)') is null then
    raise notice 'search_attachments skipped: space_attachments not present'; return;
  end if;

  -- Files in a Space whose name, owner or text holds the query, with the
  -- words around the first place the text does.
  execute $f$
    create or replace function public.search_attachments(p_space uuid, p_query text, p_limit int default 20)
    returns table (
      id uuid, name text, mime_type text, element_id uuid, object_id uuid, strategy_id uuid,
      portfolio_id uuid, deal_id uuid, company_id uuid, owner_label text, element_object_id uuid, snippet text
    )
    language sql stable security invoker set search_path = public as $body$
      with q as (select '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern)
      select s.id, s.name, s.mime_type, s.element_id, s.object_id, s.strategy_id, s.portfolio_id, s.deal_id, s.company_id,
        s.owner_label, s.element_object_id,
        case when x.pos > 0 then
          (case when x.pos > 40 then '…' else '' end)
          || regexp_replace(substr(t.body, greatest(1, x.pos - 40), 140), '\s+', ' ', 'g')
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
  execute 'grant execute on function public.search_attachments(uuid, text, int) to authenticated';

  -- Files in a Space whose text has not been taken out yet (the browser
  -- reads them in the background and writes attachment_texts).
  execute $f$
    create or replace function public.attachments_to_index(p_space uuid, p_limit int default 20)
    returns table (id uuid, path text, name text, mime_type text, size bigint)
    language sql stable security invoker set search_path = public as $body$
      select s.id, s.path, s.name, s.mime_type, s.size
      from public.space_attachments(p_space) s
      where not exists (select 1 from public.attachment_texts t where t.attachment_id = s.id)
      order by s.created_at desc
      limit greatest(1, least(p_limit, 50))
    $body$
  $f$;
  execute 'grant execute on function public.attachments_to_index(uuid, int) to authenticated';
end $$;

-- The Files app: every file attached in a Space, as its latest version,
-- with what it is attached to (and, for an Element, its Object, to open it). A file's Space is its owner's — an Element's
-- through its Object's Domain, an Object's through its Domain, an
-- Initiative's through its Portfolio, a Portfolio's, deal's and company's
-- directly. Security invoker: attachments' RLS (and each owner's) decides
-- what comes back.
do $$
begin
  if to_regclass('public.attachments') is null or to_regclass('public.elements') is null or to_regclass('public.objects') is null
     or to_regclass('public.domains') is null or to_regclass('public.strategies') is null or to_regclass('public.portfolios') is null
     or to_regclass('public.crm_deals') is null or to_regclass('public.crm_companies') is null then
    raise notice 'space_attachments skipped: a table it reads is not present'; return;
  end if;
  execute 'drop function if exists public.space_attachments(uuid)';
  execute $f$
    create or replace function public.space_attachments(p_space uuid)
    returns table (
      id uuid, path text, name text, size bigint, mime_type text, uploaded_by uuid, created_at timestamptz,
      deleted_at timestamptz, previous_id uuid, element_id uuid, object_id uuid, strategy_id uuid,
      portfolio_id uuid, deal_id uuid, company_id uuid, owner_label text, element_object_id uuid, versions int
    )
    language sql stable security invoker set search_path = public as $body$
      with recursive chain as (
        select a.id, a.id as root from attachments a where a.previous_id is null
        union all
        select a.id, c.root from attachments a join chain c on a.previous_id = c.id
      ),
      counts as (select root, count(*)::int as n from chain group by root),
      heads as (
        select a.* from attachments a
        where a.deleted_at is null and not exists (select 1 from attachments n where n.previous_id = a.id)
      )
      select h.id, h.path, h.name, h.size, h.mime_type, h.uploaded_by, h.created_at, h.deleted_at, h.previous_id,
        h.element_id, h.object_id, h.strategy_id, h.portfolio_id, h.deal_id, h.company_id,
        coalesce(e.title, ob.name, s.name, p.name, dl.name, co.name) as owner_label,
        e.object_id as element_object_id,
        coalesce(ct.n, 1) as versions
      from heads h
      left join chain ch on ch.id = h.id
      left join counts ct on ct.root = ch.root
      left join elements e on e.id = h.element_id
      left join objects eo on eo.id = e.object_id
      left join objects ob on ob.id = h.object_id
      left join domains d on d.id = coalesce(eo.domain_id, ob.domain_id)
      left join strategies s on s.id = h.strategy_id
      left join portfolios p on p.id = coalesce(h.portfolio_id, s.portfolio_id)
      left join crm_deals dl on dl.id = h.deal_id
      left join crm_companies co on co.id = h.company_id
      where coalesce(d.activity_space_id, p.activity_space_id, dl.activity_space_id, co.activity_space_id) = p_space
      order by h.created_at desc
    $body$
  $f$;
  execute 'grant execute on function public.space_attachments(uuid) to authenticated';
end $$;

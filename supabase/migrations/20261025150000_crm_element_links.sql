-- The work about a customer or a supplier is Elements: the vetting, the
-- quote, the delivery. An Element can be linked to a company, a contact or a
-- deal, so the record shows every piece of work about it — and when a
-- counterpart fails, the impact is one list, not a text search. A link is
-- visible to whoever can see both the Element and the record; an Element in
-- an Object links only to records of that Object's Space.
do $$
begin
  if to_regclass('public.crm_companies') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.element_objects') is null
     or to_regclass('public.object_domains') is null
     or to_regprocedure('public.crm_activity_visible(uuid, uuid, uuid, uuid)') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null then
    raise notice 'crm element links skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  create table if not exists public.crm_element_links (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    element_id uuid not null references public.elements(id) on delete cascade,
    company_id uuid,
    contact_id uuid,
    deal_id uuid,
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    check (num_nonnulls(company_id, contact_id, deal_id) = 1),
    foreign key (company_id, activity_space_id) references public.crm_companies(id, activity_space_id) on delete cascade,
    foreign key (contact_id, activity_space_id) references public.crm_contacts(id, activity_space_id) on delete cascade,
    foreign key (deal_id, activity_space_id) references public.crm_deals(id, activity_space_id) on delete cascade
  );
  create unique index if not exists crm_element_links_company on public.crm_element_links (element_id, company_id) where company_id is not null;
  create unique index if not exists crm_element_links_contact on public.crm_element_links (element_id, contact_id) where contact_id is not null;
  create unique index if not exists crm_element_links_deal on public.crm_element_links (element_id, deal_id) where deal_id is not null;
  create index if not exists crm_element_links_space on public.crm_element_links (activity_space_id);
  create index if not exists crm_element_links_element on public.crm_element_links (element_id);
  alter table public.crm_element_links enable row level security;

  -- An Element belongs to the Spaces of the Objects it lives in — its own and
  -- any it is also filed in; one with no Object at all is personal and links
  -- anywhere its owner can.
  create or replace function public.crm_element_in_space(p_element uuid, p_space uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    with homes as (
      select e.object_id as object_id from public.elements e where e.id = p_element and e.object_id is not null
      union
      select eo.object_id from public.element_objects eo where eo.element_id = p_element
    )
    select exists (
      select 1 from homes h join public.objects o on o.id = h.object_id
      where exists (select 1 from public.domains d where d.id = o.domain_id and d.activity_space_id = p_space)
         or exists (select 1 from public.object_domains od join public.domains d on d.id = od.domain_id where od.object_id = o.id and d.activity_space_id = p_space)
    ) or (
      exists (select 1 from public.elements e where e.id = p_element)
      and not exists (select 1 from homes)
    );
  $fn$;

  -- Elements a reader may link here: what they can see, in this Space.
  create or replace function public.crm_search_elements(p_space uuid, p_query text)
  returns table (id uuid, title text, status text, due_date date, display_id text)
  language sql stable security invoker set search_path = public as $fn$
    select e.id, e.title, e.status, e.due_date, e.display_id from public.elements e
    where (e.title ilike '%' || p_query || '%' or e.display_id ilike '%' || p_query || '%')
      and public.crm_element_in_space(e.id, p_space)
    order by e.updated_at desc
    limit 20;
  $fn$;
  revoke all on function public.crm_search_elements(uuid, text) from public, anon;
  grant execute on function public.crm_search_elements(uuid, text) to authenticated;
  revoke all on function public.crm_element_in_space(uuid, uuid) from public, anon;
  grant execute on function public.crm_element_in_space(uuid, uuid) to authenticated;

  drop policy if exists crm_element_links_read on public.crm_element_links;
  drop policy if exists crm_element_links_write on public.crm_element_links;
  drop policy if exists crm_element_links_delete on public.crm_element_links;
  create policy crm_element_links_read on public.crm_element_links for select to authenticated
    using (public.user_can_see_element(element_id) and public.crm_activity_visible(activity_space_id, deal_id, company_id, contact_id));
  create policy crm_element_links_write on public.crm_element_links for insert to authenticated
    with check (public.user_can_see_element(element_id) and public.crm_element_in_space(element_id, activity_space_id)
      and public.crm_activity_visible(activity_space_id, deal_id, company_id, contact_id));
  create policy crm_element_links_delete on public.crm_element_links for delete to authenticated
    using (public.user_can_see_element(element_id) and public.crm_activity_visible(activity_space_id, deal_id, company_id, contact_id));
  $ddl$;
end $$;

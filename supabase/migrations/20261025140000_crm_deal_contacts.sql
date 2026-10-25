-- A deal involves several people, each with a part in the decision: who
-- decides, who champions it, who blocks it. The deal's contact stays its main
-- contact; crm_deal_contacts holds everyone else on the buying side. A row is
-- visible to whoever can see both the deal and the contact, like history.
do $$
begin
  if to_regclass('public.crm_deals') is null
     or to_regclass('public.crm_contacts') is null
     or to_regprocedure('public.crm_activity_visible(uuid, uuid, uuid, uuid)') is null then
    raise notice 'crm deal contacts skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  create table if not exists public.crm_deal_contacts (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    deal_id uuid not null,
    contact_id uuid not null,
    role text not null default 'influencer' check (role in ('decision_maker','champion','influencer','blocker','user','other')),
    note text check (note is null or length(note) <= 280),
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    unique (deal_id, contact_id),
    foreign key (deal_id, activity_space_id) references public.crm_deals(id, activity_space_id) on delete cascade,
    foreign key (contact_id, activity_space_id) references public.crm_contacts(id, activity_space_id) on delete cascade
  );
  create index if not exists crm_deal_contacts_space on public.crm_deal_contacts (activity_space_id);
  create index if not exists crm_deal_contacts_contact on public.crm_deal_contacts (contact_id);
  alter table public.crm_deal_contacts enable row level security;

  drop policy if exists crm_deal_contacts_visible on public.crm_deal_contacts;
  create policy crm_deal_contacts_visible on public.crm_deal_contacts for all to authenticated
    using (public.crm_activity_visible(activity_space_id, deal_id, null, contact_id))
    with check (public.crm_activity_visible(activity_space_id, deal_id, null, contact_id));
  $ddl$;
end $$;

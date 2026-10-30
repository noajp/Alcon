-- CRM: a Space's customer records, shared by its members.
-- Pipelines hold their own stages and forecast settings; deals move through
-- them, owned by a Worker, tied to a company and a contact, and linked to the
-- Element that is their next step and the Initiative they contribute to.
-- Activities are an append-only history: stage changes are written by the
-- database, and a logged call, email or meeting advances the last contact.
-- Fields lets each Space add its own attributes to deals, companies and
-- contacts. Cross-row references are composite (id, activity_space_id), so a
-- row can never point into another Space.
do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.workers') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.strategies') is null
     or to_regclass('public.intents') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'crm schema skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  create table if not exists public.crm_pipelines (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    name text not null check (length(btrim(name)) between 1 and 80),
    -- [{ "id": "proposal", "label": "Proposal", "probability": 50 }, …]; won and lost are implicit.
    stages jsonb not null default '[{"id":"lead","label":"Lead","probability":10},{"id":"qualified","label":"Qualified","probability":25},{"id":"proposal","label":"Proposal","probability":50},{"id":"negotiation","label":"Negotiation","probability":75}]'::jsonb
      check (jsonb_typeof(stages) = 'array' and jsonb_array_length(stages) between 1 and 12),
    currency text not null default 'JPY' check (currency ~ '^[A-Z]{3}$'),
    horizon_days integer not null default 30 check (horizon_days between 1 and 3650),
    follow_up_days integer not null default 14 check (follow_up_days between 1 and 3650),
    -- Where this pipeline's next-step Elements are filed.
    object_id uuid references public.objects(id) on delete set null,
    -- The Initiative success condition this pipeline reports into.
    measure_intent_id uuid references public.intents(id) on delete set null,
    measure_metric text check (measure_metric is null or measure_metric in ('won_quarter','won_year','won_total','weighted','open')),
    order_index real not null default 0,
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    unique (id, activity_space_id)
  );

  create table if not exists public.crm_companies (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    name text not null check (length(btrim(name)) between 1 and 200),
    domain text check (domain is null or length(domain) <= 200),
    industry text check (industry is null or length(industry) <= 120),
    owner_worker_id uuid references public.workers(id) on delete set null,
    notes text,
    custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object'),
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, activity_space_id)
  );

  create table if not exists public.crm_contacts (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    company_id uuid,
    name text not null check (length(btrim(name)) between 1 and 200),
    title text check (title is null or length(title) <= 160),
    email text check (email is null or length(email) <= 254),
    phone text check (phone is null or length(phone) <= 64),
    owner_worker_id uuid references public.workers(id) on delete set null,
    custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object'),
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, activity_space_id),
    foreign key (company_id, activity_space_id) references public.crm_companies(id, activity_space_id) on delete set null (company_id)
  );

  create table if not exists public.crm_deals (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    pipeline_id uuid not null,
    number integer not null,
    name text not null check (length(btrim(name)) between 1 and 200),
    company_id uuid,
    contact_id uuid,
    owner_worker_id uuid references public.workers(id) on delete set null,
    stage text not null check (length(btrim(stage)) between 1 and 40),
    amount numeric check (amount is null or amount >= 0),
    currency text not null default 'JPY' check (currency ~ '^[A-Z]{3}$'),
    probability integer check (probability is null or probability between 0 and 100),
    close_date date,
    last_contact_on date,
    next_step text check (next_step is null or length(next_step) <= 280),
    next_step_on date,
    next_element_id uuid references public.elements(id) on delete set null,
    initiative_id uuid references public.strategies(id) on delete set null,
    source text check (source is null or length(source) <= 80),
    lost_reason text check (lost_reason is null or length(lost_reason) <= 280),
    closed_on date,
    custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object'),
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, activity_space_id),
    unique (activity_space_id, number),
    foreign key (pipeline_id, activity_space_id) references public.crm_pipelines(id, activity_space_id) on delete cascade,
    foreign key (company_id, activity_space_id) references public.crm_companies(id, activity_space_id) on delete set null (company_id),
    foreign key (contact_id, activity_space_id) references public.crm_contacts(id, activity_space_id) on delete set null (contact_id)
  );

  create table if not exists public.crm_activities (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null,
    deal_id uuid,
    company_id uuid,
    contact_id uuid,
    kind text not null check (kind in ('call','email','meeting','note','stage')),
    body text not null check (length(body) between 1 and 8000),
    occurred_on date not null default current_date,
    created_by uuid default auth.uid(),
    author_name text,
    created_at timestamptz not null default now(),
    check (deal_id is not null or company_id is not null or contact_id is not null),
    foreign key (deal_id, activity_space_id) references public.crm_deals(id, activity_space_id) on delete cascade,
    foreign key (company_id, activity_space_id) references public.crm_companies(id, activity_space_id) on delete cascade,
    foreign key (contact_id, activity_space_id) references public.crm_contacts(id, activity_space_id) on delete cascade
  );

  create table if not exists public.crm_fields (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    entity text not null check (entity in ('deal','company','contact')),
    key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
    label text not null check (length(btrim(label)) between 1 and 80),
    type text not null check (type in ('text','number','date','select','checkbox')),
    options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
    order_index real not null default 0,
    created_at timestamptz not null default now(),
    unique (activity_space_id, entity, key)
  );

  create index if not exists crm_pipelines_space on public.crm_pipelines (activity_space_id);
  create index if not exists crm_pipelines_object on public.crm_pipelines (object_id);
  create index if not exists crm_pipelines_intent on public.crm_pipelines (measure_intent_id);
  create index if not exists crm_companies_space on public.crm_companies (activity_space_id);
  create index if not exists crm_companies_owner on public.crm_companies (owner_worker_id);
  create index if not exists crm_contacts_space on public.crm_contacts (activity_space_id);
  create index if not exists crm_contacts_company on public.crm_contacts (company_id);
  create index if not exists crm_contacts_owner on public.crm_contacts (owner_worker_id);
  create index if not exists crm_deals_space on public.crm_deals (activity_space_id, pipeline_id);
  create index if not exists crm_deals_pipeline on public.crm_deals (pipeline_id);
  create index if not exists crm_deals_company on public.crm_deals (company_id);
  create index if not exists crm_deals_contact on public.crm_deals (contact_id);
  create index if not exists crm_deals_owner on public.crm_deals (owner_worker_id);
  create index if not exists crm_deals_element on public.crm_deals (next_element_id);
  create index if not exists crm_deals_initiative on public.crm_deals (initiative_id);
  create index if not exists crm_activities_deal on public.crm_activities (deal_id, occurred_on desc);
  create index if not exists crm_activities_company on public.crm_activities (company_id);
  create index if not exists crm_activities_contact on public.crm_activities (contact_id);
  create index if not exists crm_activities_space on public.crm_activities (activity_space_id, created_at desc);
  create index if not exists crm_fields_space on public.crm_fields (activity_space_id, entity);
  $ddl$;

  -- Members of the owning Space read and write every CRM record.
  execute $ddl$
  do $inner$
  declare t text;
  begin
    foreach t in array array['crm_pipelines','crm_companies','crm_contacts','crm_deals','crm_fields'] loop
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t || '_members', t);
      execute format('create policy %I on public.%I for all to authenticated using (public.is_activity_space_member(activity_space_id)) with check (public.is_activity_space_member(activity_space_id))', t || '_members', t);
    end loop;
  end $inner$;
  $ddl$;

  -- The history is append-only: members add entries; only the author may
  -- remove a manual one. Stage entries are written by the database.
  execute $ddl$
  alter table public.crm_activities enable row level security;
  drop policy if exists crm_activities_read on public.crm_activities;
  drop policy if exists crm_activities_write on public.crm_activities;
  drop policy if exists crm_activities_delete on public.crm_activities;
  create policy crm_activities_read on public.crm_activities for select to authenticated using (public.is_activity_space_member(activity_space_id));
  create policy crm_activities_write on public.crm_activities for insert to authenticated with check (public.is_activity_space_member(activity_space_id) and kind <> 'stage');
  create policy crm_activities_delete on public.crm_activities for delete to authenticated using (public.is_activity_space_member(activity_space_id) and created_by = auth.uid() and kind <> 'stage');
  $ddl$;

  -- Deal numbers count up per Space; updated_at and closed_on follow edits.
  execute $ddl$
  create or replace function public.crm_number_deal() returns trigger
  language plpgsql security invoker set search_path = public as $fn$
  begin
    perform pg_advisory_xact_lock(hashtext('crm_deal:' || new.activity_space_id::text));
    select coalesce(max(number), 0) + 1 into new.number from public.crm_deals where activity_space_id = new.activity_space_id;
    if lower(new.stage) in ('won','lost') then new.closed_on := coalesce(new.closed_on, current_date); end if;
    return new;
  end $fn$;
  drop trigger if exists crm_deals_number on public.crm_deals;
  create trigger crm_deals_number before insert on public.crm_deals
    for each row execute function public.crm_number_deal();

  create or replace function public.crm_touch_deal() returns trigger
  language plpgsql security invoker set search_path = public as $fn$
  begin
    new.updated_at := now();
    if lower(new.stage) in ('won','lost') and lower(old.stage) not in ('won','lost') then
      new.closed_on := coalesce(new.close_date, current_date);
    elsif lower(new.stage) not in ('won','lost') then
      new.closed_on := null;
    end if;
    return new;
  end $fn$;
  drop trigger if exists crm_deals_touch on public.crm_deals;
  create trigger crm_deals_touch before update on public.crm_deals
    for each row execute function public.crm_touch_deal();

  create or replace function public.crm_touch_record() returns trigger
  language plpgsql security invoker set search_path = public as $fn$
  begin new.updated_at := now(); return new; end $fn$;
  drop trigger if exists crm_companies_touch on public.crm_companies;
  create trigger crm_companies_touch before update on public.crm_companies
    for each row execute function public.crm_touch_record();
  drop trigger if exists crm_contacts_touch on public.crm_contacts;
  create trigger crm_contacts_touch before update on public.crm_contacts
    for each row execute function public.crm_touch_record();
  $ddl$;

  -- A stage change is history the database writes, so it cannot be skipped
  -- or forged. Definer rights only to bypass the insert policy's kind check;
  -- the row is the caller's own deal update, already allowed by RLS.
  execute $ddl$
  create or replace function public.crm_log_stage() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if new.stage is distinct from old.stage then
      insert into public.crm_activities (activity_space_id, deal_id, company_id, kind, body, occurred_on, created_by)
      values (new.activity_space_id, new.id, new.company_id, 'stage', old.stage || ' → ' || new.stage, current_date, auth.uid());
    end if;
    return new;
  end $fn$;
  revoke all on function public.crm_log_stage() from public;
  revoke execute on function public.crm_log_stage() from anon, authenticated;
  drop trigger if exists crm_deals_log_stage on public.crm_deals;
  create trigger crm_deals_log_stage after update of stage on public.crm_deals
    for each row execute function public.crm_log_stage();
  $ddl$;

  -- A logged call, email or meeting moves the deal's last contact forward
  -- (never backward, never into the future). Runs as the caller.
  execute $ddl$
  create or replace function public.crm_advance_contact() returns trigger
  language plpgsql security invoker set search_path = public as $fn$
  begin
    if new.deal_id is not null and new.kind in ('call','email','meeting') and new.occurred_on <= current_date then
      update public.crm_deals set last_contact_on = new.occurred_on
      where id = new.deal_id and (last_contact_on is null or last_contact_on < new.occurred_on);
    end if;
    return new;
  end $fn$;
  drop trigger if exists crm_activities_contact on public.crm_activities;
  create trigger crm_activities_contact after insert on public.crm_activities
    for each row execute function public.crm_advance_contact();
  $ddl$;
end $$;

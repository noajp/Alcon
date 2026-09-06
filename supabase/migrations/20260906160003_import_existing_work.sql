-- One confirmed import is one transaction. The receipt makes a lost response
-- retryable without creating a second project or a second set of Elements.
do $migration$
begin
  if exists (select 1 from unnest(array[
    'elements','objects','domains','element_objects','element_assignees','object_domains',
    'domain_members','object_members','workers','activity_spaces','activity_space_members'
  ]) t(name) where to_regclass('public.' || name) is null)
    or to_regprocedure('public.user_can_see_object(uuid)') is null
    or to_regprocedure('public.user_can_see_domain(uuid)') is null
    or to_regprocedure('public.is_activity_space_member(uuid)') is null
    or to_regclass('auth.users') is null then return; end if;

  -- The junction's owner-only SELECT policy hides legitimate secondary homes.
  -- This private read helper answers membership only and still requires the
  -- canonical visibility boundary. All mutations below remain SECURITY INVOKER.
  create schema if not exists alcon_internal;
  revoke all on schema alcon_internal from public, anon;
  grant usage on schema alcon_internal to authenticated;
  execute $helper$
    create or replace function alcon_internal.work_import_object_in_space(p_object_id uuid, p_space_id uuid)
    returns boolean language sql stable security definer set search_path = '' as $body$
      select auth.uid() is not null and public.is_activity_space_member(p_space_id)
        and public.user_can_see_object(p_object_id)
        and exists (select 1 from public.objects o where o.id=p_object_id and (
          exists(select 1 from public.domains d where d.id=o.domain_id and d.activity_space_id=p_space_id)
          or exists(select 1 from public.object_domains od join public.domains d on d.id=od.domain_id
            where od.object_id=o.id and d.activity_space_id=p_space_id)));
    $body$
  $helper$;
  revoke all on function alcon_internal.work_import_object_in_space(uuid,uuid) from public, anon;
  grant execute on function alcon_internal.work_import_object_in_space(uuid,uuid) to authenticated;

  create table if not exists public.work_import_receipts (
    id uuid primary key,
    created_by uuid not null references auth.users(id) on delete cascade,
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    -- Preserve the receipt after a project is removed so a delayed retry cannot
    -- recreate deleted work under the same request ID.
    object_id uuid,
    outcome text not null default 'committed' check(outcome in ('committed','abandoned')),
    request jsonb not null,
    result jsonb not null,
    created_at timestamptz not null default now(),
    check ((outcome='committed' and object_id is not null)
      or (outcome='abandoned' and object_id is null and request='{}'::jsonb and result='[]'::jsonb))
  );
  alter table public.work_import_receipts enable row level security;
  create index if not exists work_import_receipts_created_by on public.work_import_receipts(created_by);
  drop policy if exists "read own work imports" on public.work_import_receipts;
  create policy "read own work imports" on public.work_import_receipts for select to authenticated
    using (created_by = (select auth.uid()));
  drop policy if exists "record own work imports" on public.work_import_receipts;
  create policy "record own work imports" on public.work_import_receipts for insert to authenticated
    with check (created_by = (select auth.uid())
      and ((outcome='committed' and alcon_internal.work_import_object_in_space(object_id,activity_space_id))
        or (outcome='abandoned' and public.is_activity_space_member(activity_space_id))));
  revoke all on public.work_import_receipts from anon, authenticated;
  grant select, insert on public.work_import_receipts to authenticated;

  execute $function$
    create or replace function public.import_existing_work(
      p_space_id uuid, p_batch_id uuid, p_object_id uuid, p_domain_id uuid,
      p_project_name text, p_rows jsonb
    ) returns jsonb language plpgsql security invoker set search_path = '' as $body$
    declare
      v_user uuid := auth.uid();
      v_request jsonb;
      v_receipt public.work_import_receipts%rowtype;
      v_object uuid := p_object_id;
      v_domain uuid := p_domain_id;
      v_row jsonb;
      v_id uuid;
      v_worker uuid;
      v_date date;
      v_description text;
      v_source jsonb;
      v_result jsonb := '[]'::jsonb;
      v_count integer;
    begin
      if v_user is null or p_batch_id is null or p_space_id is null or not public.is_activity_space_member(p_space_id) then
        raise exception 'An authenticated Space member is required' using errcode = '42501';
      end if;
      if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Import rows must be an array'; end if;
      v_count := jsonb_array_length(p_rows);
      if v_count < 1 or v_count > 100 or octet_length(p_rows::text) > 1048576 then
        raise exception 'Import 1 to 100 Elements, up to 1 MB, at a time';
      end if;
      if (select count(distinct r->>'rowKey') from jsonb_array_elements(p_rows) r) <> v_count then
        raise exception 'Every import row must have a unique key';
      end if;
      v_request := jsonb_build_object('space',p_space_id,'object',p_object_id,'domain',p_domain_id,
        'name',p_project_name,'rows',p_rows);
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_batch_id::text, 0));
      select * into v_receipt from public.work_import_receipts where id = p_batch_id;
      if found then
        if v_receipt.outcome='abandoned' then
          raise exception 'This import was closed before any work was saved. Start a new import.' using errcode='P2001';
        end if;
        if v_receipt.created_by <> v_user or v_receipt.request <> v_request then
          raise exception 'This import was already used with different contents';
        end if;
        if not alcon_internal.work_import_object_in_space(v_receipt.object_id,p_space_id) or exists (
          select 1 from jsonb_array_elements(v_receipt.result) r
          where not exists (select 1 from public.elements e
            where e.id = (r->>'elementId')::uuid and e.object_id = v_receipt.object_id)
        ) then raise exception 'Imported work has been removed or is no longer visible. Open the project to check it.' using errcode='P2002'; end if;
        return jsonb_build_object('saved',v_receipt.result,'objectId',v_receipt.object_id,'replayed',true);
      end if;

      if v_object is not null then
        if not alcon_internal.work_import_object_in_space(v_object,p_space_id) then
          raise exception 'Choose a visible project in this Space' using errcode = '42501';
        end if;
      else
        if nullif(btrim(p_project_name),'') is null or length(p_project_name) > 160 then
          raise exception 'Give this project a name of up to 160 characters';
        end if;
        if v_domain is not null then
          perform 1 from public.domains d where d.id=v_domain and d.activity_space_id=p_space_id and public.user_can_see_domain(d.id);
          if not found then raise exception 'Choose a visible Domain in this Space' using errcode = '42501'; end if;
        else
          -- The first real project creates its storage container. Users need
          -- not learn the Domain/Object taxonomy before bringing their work.
          insert into public.domains(name,user_id,activity_space_id,privacy)
            values ('General',v_user,p_space_id,'workspace') returning id into v_domain;
          insert into public.domain_members(domain_id,user_id,role) values(v_domain,v_user,'owner');
        end if;
        insert into public.objects(name,domain_id,user_id) values(btrim(p_project_name),v_domain,v_user) returning id into v_object;
        insert into public.object_members(object_id,user_id,role) values(v_object,v_user,'owner');
        -- The primary FK already establishes this home. Its duplicate junction
        -- is writable only by the Domain creator under the existing policy.
        if exists(select 1 from public.domains d where d.id=v_domain and d.user_id=v_user) then
          insert into public.object_domains(object_id,domain_id) values(v_object,v_domain) on conflict do nothing;
        end if;
      end if;

      for v_row in select value from jsonb_array_elements(p_rows) loop
        if jsonb_typeof(v_row) <> 'object' or nullif(btrim(v_row->>'rowKey'),'') is null
          or length(v_row->>'rowKey') > 120 or nullif(btrim(v_row->>'title'),'') is null
          or jsonb_typeof(v_row->'title') <> 'string' or jsonb_typeof(v_row->'rowKey') <> 'string'
          or length(v_row->>'title') > 500 or length(coalesce(v_row->>'description','')) > 20000
          or (v_row->>'status') is null or (v_row->>'status') not in ('backlog','todo','in_progress','review','done','blocked','cancelled') then
          raise exception 'Invalid title, status, or description in import row %', v_row->>'sourceRow';
        end if;
        v_date := null;
        if nullif(v_row->>'due_date','') is not null then
          if (v_row->>'due_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Use unambiguous ISO dates'; end if;
          v_date := (v_row->>'due_date')::date;
          if to_char(v_date,'YYYY-MM-DD') <> v_row->>'due_date' then raise exception 'Invalid date'; end if;
        end if;
        v_worker := nullif(v_row->>'worker_id','')::uuid;
        if v_worker is not null and not exists (
          select 1 from public.workers w where w.id=v_worker and w.status is distinct from 'inactive' and (
            w.object_id=v_object
            or (w.user_id is not null and exists(select 1 from public.activity_space_members sm where sm.activity_space_id=p_space_id and sm.user_id=w.user_id))
            or exists(select 1 from public.element_assignees ea join public.elements e on e.id=ea.element_id
              join public.objects o on o.id=e.object_id or exists(select 1 from public.element_objects eo where eo.element_id=e.id and eo.object_id=o.id)
              where ea.worker_id=w.id and public.user_can_see_element(e.id)
                and alcon_internal.work_import_object_in_space(o.id,p_space_id))
          )
        ) then raise exception 'An assignee is no longer available in this Space' using errcode='42501'; end if;

        v_source := coalesce(v_row->'source','{}'::jsonb);
        if jsonb_typeof(v_source) <> 'object' or octet_length(v_source::text)>8000 then raise exception 'Invalid import source'; end if;
        v_description := nullif(concat_ws(E'\n\n', nullif(v_row->>'description',''),
          'Imported record — not synchronized with the source.' || E'\n'
          || concat_ws(E'\n',
            case when nullif(v_source->>'id','') is not null then 'Source ID: ' || (v_source->>'id') end,
            case when nullif(coalesce(v_source->>'original_url',v_source->>'url'),'') is not null then 'Source URL: ' || coalesce(v_source->>'original_url',v_source->>'url') end,
            case when nullif(v_source->>'status','') is not null then 'Source status: ' || (v_source->>'status') end,
            case when nullif(v_source->>'assignee','') is not null then 'Source assignee: ' || (v_source->>'assignee') end,
            case when nullif(v_source->>'due_date','') is not null then 'Source due date: ' || (v_source->>'due_date') end
          )), '');
        insert into public.elements(object_id,title,description,status,due_date,progress,owner_id,is_approval,approval_state)
          values(v_object,btrim(v_row->>'title'),v_description,v_row->>'status',v_date,
            case when v_row->>'status'='done' then 100 else null end,null,false,null) returning id into v_id;
        insert into public.element_objects(element_id,object_id) values(v_id,v_object) on conflict do nothing;
        if v_worker is not null then
          insert into public.element_assignees(element_id,worker_id,role) values(v_id,v_worker,'assignee');
        end if;
        v_result := v_result || jsonb_build_array(jsonb_build_object('rowKey',v_row->>'rowKey','elementId',v_id));
      end loop;
      insert into public.work_import_receipts(id,created_by,activity_space_id,object_id,request,result)
        values(p_batch_id,v_user,p_space_id,v_object,v_request,v_result);
      return jsonb_build_object('saved',v_result,'objectId',v_object,'replayed',false);
    end;
    $body$
  $function$;
  revoke all on function public.import_existing_work(uuid,uuid,uuid,uuid,text,jsonb) from public, anon;
  grant execute on function public.import_existing_work(uuid,uuid,uuid,uuid,text,jsonb) to authenticated;

  -- Explicit recovery is an atomic decision, not a racy "receipt absent" read:
  -- closing an uncommitted batch leaves a tombstone that blocks a delayed HTTP
  -- request from creating work after the user resumes with a new batch.
  execute $resolver$
    create or replace function public.resolve_work_import(p_space_id uuid,p_batch_id uuid)
    returns jsonb language plpgsql security invoker set search_path='' as $body$
    declare v_receipt public.work_import_receipts%rowtype; v_available boolean;
    begin
      if auth.uid() is null or p_space_id is null or p_batch_id is null then
        raise exception 'Sign in to resolve this import' using errcode='42501';
      end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_batch_id::text,0));
      select * into v_receipt from public.work_import_receipts where id=p_batch_id;
      if found then
        if v_receipt.activity_space_id<>p_space_id then raise exception 'This batch belongs to another Space' using errcode='42501'; end if;
        if v_receipt.outcome='abandoned' then return jsonb_build_object('committed',false,'available',false); end if;
        v_available := alcon_internal.work_import_object_in_space(v_receipt.object_id,p_space_id)
          and not exists(select 1 from jsonb_array_elements(v_receipt.result) r where not exists(
            select 1 from public.elements e where e.id=(r->>'elementId')::uuid and e.object_id=v_receipt.object_id));
        return jsonb_build_object('committed',true,'available',v_available);
      end if;
      if not public.is_activity_space_member(p_space_id) then
        raise exception 'Space membership is required to close an unsaved import' using errcode='42501';
      end if;
      insert into public.work_import_receipts(id,created_by,activity_space_id,object_id,outcome,request,result)
        values(p_batch_id,auth.uid(),p_space_id,null,'abandoned','{}','[]');
      return jsonb_build_object('committed',false,'available',false);
    end;
    $body$
  $resolver$;
  revoke all on function public.resolve_work_import(uuid,uuid) from public,anon;
  grant execute on function public.resolve_work_import(uuid,uuid) to authenticated;
end;
$migration$;

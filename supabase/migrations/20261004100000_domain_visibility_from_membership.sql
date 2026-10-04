-- A Domain is visible through membership and its Space's privacy, never
-- through having created it (ELE_AI-108, ADR 0029).
--
-- user_can_see_domain had a creator branch (domains.user_id = auth.uid()),
-- so a creator removed from their Domain still saw it: its Objects and
-- Elements, Object creation inside it (objects insert checks
-- user_can_see_domain), and re-joining it as a member through Discover
-- ("dm insert self" checks the same function). Creators are enrolled as
-- owners by domains_enrol_creator in the same INSERT, so the branch no longer
-- admits anyone that membership does not, except the people who were
-- removed. Every copy of the rule loses it:
--
--   - public.user_can_see_domain           (per row, the caller)
--   - alcon_internal.user_can_see_domain_as (per row, another user)
--   - alcon_internal.visible_domain_ids     (the set form)
--   - "domains select visible"              (the domains SELECT policy)
--   - public.can_edit_domain_approaches     (creator OR owner/admin -> owner/admin)
--   - public.import_existing_work           (wrote the primary object_domains
--     row only when the caller had created the Domain; the caller owns the
--     new Object, which user_can_link_object_domain already admits)
--
-- Domain UPDATE / DELETE are already keyed on membership
-- (user_has_domain_role owner/admin, owner); they stay as they are.
-- "domains insert authenticated" keeps user_id = auth.uid(): that stamps the
-- creator column at creation and grants nothing afterwards.
--
-- Because the SELECT policy no longer admits the creator, a Domain row cannot
-- be returned from its own INSERT when only the AFTER INSERT owner row would
-- make it visible (a private Domain, or one with no Space). createDomain
-- writes without RETURNING and reads the row back, like createObject.
--
-- Data: on production every Domain's creator holds an owner row, so nobody
-- loses a Domain they can see today except removed creators. The backfill
-- below enrols the creator as owner of any Domain left with no owner at all
-- (0 rows on production), so no Domain becomes invisible to everyone.
--
-- Function bodies are the production definitions minus the creator branch;
-- signatures, security and search_path are unchanged (create or replace
-- keeps the grants). Guarded for preview replay (the base schema lives
-- outside this folder).
do $$
begin
  if to_regclass('public.domains') is null
     or to_regclass('public.domain_members') is null
     or to_regclass('public.activity_space_members') is null then
    raise notice 'domain_visibility_from_membership skipped: base schema not present';
    return;
  end if;

  -- No Domain may be left without an owner once the creator branch is gone.
  insert into public.domain_members (domain_id, user_id, role)
  select d.id, d.user_id, 'owner'
    from public.domains d
   where d.user_id is not null
     and exists (select 1 from auth.users u where u.id = d.user_id)
     and not exists (select 1 from public.domain_members m
                      where m.domain_id = d.id and m.role = 'owner')
  on conflict (domain_id, user_id) do update set role = 'owner';

  if to_regprocedure('public.user_is_domain_member(uuid)') is not null
     and to_regprocedure('public.is_activity_space_member(uuid)') is not null then
    execute $f$
      create or replace function public.user_can_see_domain(_domain_id uuid)
      returns boolean language sql stable security definer set search_path = public as $b$
        select exists (
          select 1 from domains d
          where d.id = _domain_id
            and (
              public.user_is_domain_member(d.id)
              or (d.privacy = 'workspace'
                  and d.activity_space_id is not null
                  and public.is_activity_space_member(d.activity_space_id))
            )
        );
      $b$
    $f$;

    execute 'drop policy if exists "domains select visible" on public.domains';
    execute 'create policy "domains select visible" on public.domains
      for select
      using (
        public.user_is_domain_member(id)
        or (privacy = ''workspace''
            and activity_space_id is not null
            and public.is_activity_space_member(activity_space_id))
      )';
  end if;

  if to_regprocedure('alcon_internal.user_is_domain_member_as(uuid, uuid)') is not null
     and to_regprocedure('alcon_internal.is_activity_space_member_as(uuid, uuid)') is not null then
    execute $f$
      create or replace function alcon_internal.user_can_see_domain_as(p_domain uuid, p_user uuid)
      returns boolean language sql stable security definer set search_path = public as $b$
        select exists (
          select 1 from public.domains d
          where d.id = p_domain
            and (
              alcon_internal.user_is_domain_member_as(d.id, p_user)
              or (d.privacy = 'workspace'
                  and d.activity_space_id is not null
                  and alcon_internal.is_activity_space_member_as(d.activity_space_id, p_user))
            )
        );
      $b$
    $f$;
  end if;

  if to_regprocedure('alcon_internal.visible_domain_ids()') is not null then
    execute $f$
      create or replace function alcon_internal.visible_domain_ids()
      returns setof uuid language sql stable security definer set search_path = public as $b$
        select dm.domain_id from public.domain_members dm where dm.user_id = auth.uid()
        union
        select d.id from public.domains d
          join public.activity_space_members m on m.activity_space_id = d.activity_space_id
         where d.privacy = 'workspace' and m.user_id = auth.uid();
      $b$
    $f$;
  end if;

  if to_regprocedure('public.can_edit_domain_approaches(uuid)') is not null
     and to_regprocedure('public.user_has_domain_role(uuid, text[])') is not null then
    execute $f$
      create or replace function public.can_edit_domain_approaches(p_domain_id uuid)
      returns boolean language sql stable set search_path = public as $b$
        select auth.uid() is not null
          and public.user_has_domain_role(p_domain_id, array['owner','admin'])
      $b$
    $f$;
  end if;

  if to_regprocedure('public.import_existing_work(uuid, uuid, uuid, uuid, text, jsonb)') is not null
     and to_regclass('public.work_import_receipts') is not null
     and to_regclass('public.element_objects') is not null
     and to_regprocedure('alcon_internal.work_import_object_in_space(uuid, uuid)') is not null then
    execute $f$
      create or replace function public.import_existing_work(p_space_id uuid, p_batch_id uuid, p_object_id uuid, p_domain_id uuid, p_project_name text, p_rows jsonb)
      returns jsonb language plpgsql set search_path = '' as $b$
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
            -- domains_enrol_creator makes the caller its owner.
            insert into public.domains(name,user_id,activity_space_id,privacy)
              values ('General',v_user,p_space_id,'workspace') returning id into v_domain;
          end if;
          -- objects_enrol_creator makes the caller the project's owner.
          insert into public.objects(name,domain_id,user_id) values(btrim(p_project_name),v_domain,v_user) returning id into v_object;
          -- The primary FK already establishes this home. Its duplicate junction
          -- row is one the Object's owner may write (user_can_link_object_domain),
          -- and objects_enrol_creator has just made the caller that owner.
          insert into public.object_domains(object_id,domain_id) values(v_object,v_domain) on conflict do nothing;
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
            -- Checked against the Element just written, like every other
            -- assignment; a refusal rolls back the whole import.
            if not public.worker_assignable(v_worker, v_id) then
              raise exception 'An assignee is no longer available in this Space' using errcode='42501';
            end if;
            insert into public.element_assignees(element_id,worker_id,role) values(v_id,v_worker,'assignee');
          end if;
          v_result := v_result || jsonb_build_array(jsonb_build_object('rowKey',v_row->>'rowKey','elementId',v_id));
        end loop;
        insert into public.work_import_receipts(id,created_by,activity_space_id,object_id,request,result)
          values(p_batch_id,v_user,p_space_id,v_object,v_request,v_result);
        return jsonb_build_object('saved',v_result,'objectId',v_object,'replayed',false);
      end;
      $b$
    $f$;
  end if;
end $$;

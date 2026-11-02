-- CRM leaves Alcon. Its tables, functions and triggers are dropped, and every
-- shared object that knew about CRM forgets it first, in this order:
--
--   1. attachments   the four RLS policies and the one-owner check name the
--                    deal / company owners, and the policies depend on the
--                    CRM tables — dropping those with CASCADE would take the
--                    policies with them. The policies are rewritten without
--                    the CRM owners, then deal_id / company_id go.
--                    space_attachments and search_attachments drop the two
--                    columns from their results; attachment_owner_visible
--                    drops the two kinds.
--   2. Elements      the delete snapshot stops reading crm_element_links (a
--                    plpgsql query naming a missing table fails when planned,
--                    whichever branch runs); restore stops listing it.
--   3. Intents       crm_deal stops being a binding target and crm a reading
--                    source; the trigger that refreshed CRM measures goes.
--   4. Domains       the trigger guarding a Domain that holds CRM records.
--   5. CRM itself    tables, then every function named for CRM.
--
-- Production held no deals, companies, contacts, CRM attachments, CRM
-- bindings or CRM readings when this was written; rows of those kinds that
-- exist anywhere else are deleted with the objects that held them.

-- 1. Attachments ───────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.attachments') is null then
    raise notice 'remove_crm: attachments not present';
    return;
  end if;

  execute 'drop policy if exists attachments_select on public.attachments';
  execute 'drop policy if exists attachments_insert on public.attachments';
  execute 'drop policy if exists attachments_update on public.attachments';
  execute 'drop policy if exists attachments_delete on public.attachments';

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'attachments' and column_name = 'deal_id') then
    execute 'delete from public.attachments where deal_id is not null or company_id is not null';
  end if;
  execute 'alter table public.attachments drop constraint if exists attachments_one_owner';
  execute 'alter table public.attachments drop column if exists deal_id';
  execute 'alter table public.attachments drop column if exists company_id';
  execute 'alter table public.attachments add constraint attachments_one_owner
    check (num_nonnulls(element_id, object_id, strategy_id, portfolio_id, folder_id) = 1)';

  execute $p$
    create policy attachments_select on public.attachments for select to authenticated using (
      (element_id is not null and exists (select 1 from public.elements x where x.id = attachments.element_id))
      or (object_id is not null and exists (select 1 from public.objects x where x.id = attachments.object_id))
      or (strategy_id is not null and exists (select 1 from public.strategies x where x.id = attachments.strategy_id))
      or (portfolio_id is not null and exists (select 1 from public.portfolios x where x.id = attachments.portfolio_id))
      or (folder_id is not null and exists (select 1 from public.folders x where x.id = attachments.folder_id)))
  $p$;
  execute $p$
    create policy attachments_insert on public.attachments for insert to authenticated with check (
      uploaded_by = (select auth.uid()) and (
        (element_id is not null and exists (select 1 from public.elements x where x.id = attachments.element_id))
        or (object_id is not null and exists (select 1 from public.objects x where x.id = attachments.object_id))
        or (strategy_id is not null and exists (select 1 from public.strategies x where x.id = attachments.strategy_id))
        or (portfolio_id is not null and exists (select 1 from public.portfolios x where x.id = attachments.portfolio_id))
        or (folder_id is not null and exists (select 1 from public.folders x where x.id = attachments.folder_id))))
  $p$;
  execute $p$
    create policy attachments_update on public.attachments for update to authenticated using (
      (element_id is not null and exists (select 1 from public.elements x where x.id = attachments.element_id))
      or (object_id is not null and exists (select 1 from public.objects x where x.id = attachments.object_id))
      or (strategy_id is not null and exists (select 1 from public.strategies x where x.id = attachments.strategy_id))
      or (portfolio_id is not null and exists (select 1 from public.portfolios x where x.id = attachments.portfolio_id))
      or (folder_id is not null and exists (select 1 from public.folders x where x.id = attachments.folder_id)))
    with check (
      ((element_id is not null and exists (select 1 from public.elements x where x.id = attachments.element_id))
      or (object_id is not null and exists (select 1 from public.objects x where x.id = attachments.object_id))
      or (strategy_id is not null and exists (select 1 from public.strategies x where x.id = attachments.strategy_id))
      or (portfolio_id is not null and exists (select 1 from public.portfolios x where x.id = attachments.portfolio_id))
      or (folder_id is not null and exists (select 1 from public.folders x where x.id = attachments.folder_id)))
      and (deleted_by is null or deleted_by = (select auth.uid())))
  $p$;
  execute $p$
    create policy attachments_delete on public.attachments for delete to authenticated using (
      (((element_id is not null and exists (select 1 from public.elements x where x.id = attachments.element_id))
      or (object_id is not null and exists (select 1 from public.objects x where x.id = attachments.object_id))
      or (strategy_id is not null and exists (select 1 from public.strategies x where x.id = attachments.strategy_id))
      or (portfolio_id is not null and exists (select 1 from public.portfolios x where x.id = attachments.portfolio_id))
      or (folder_id is not null and exists (select 1 from public.folders x where x.id = attachments.folder_id)))
      and deleted_at < now() - interval '30 days')
      or public.attachment_version_prunable(id))
  $p$;

  execute $f$
    create or replace function public.attachment_owner_visible(kind text, owner text)
    returns boolean language sql stable set search_path to 'public' as $b$
      select coalesce(case kind
        when 'element' then exists (select 1 from public.elements x where x.id::text = owner)
        when 'object' then exists (select 1 from public.objects x where x.id::text = owner)
        when 'strategy' then exists (select 1 from public.strategies x where x.id::text = owner)
        when 'portfolio' then exists (select 1 from public.portfolios x where x.id::text = owner)
        when 'folder' then exists (select 1 from public.folders x where x.id::text = owner)
        else false end, false)
    $b$
  $f$;

  execute 'drop function if exists public.space_attachments(uuid, boolean)';
  execute $f$
    create function public.space_attachments(p_space uuid, p_trashed boolean default false)
    returns table(id uuid, path text, name text, size bigint, mime_type text, uploaded_by uuid,
      created_at timestamptz, deleted_at timestamptz, previous_id uuid, element_id uuid, object_id uuid,
      strategy_id uuid, portfolio_id uuid, folder_id uuid, owner_label text, element_object_id uuid,
      domain_id uuid, versions integer)
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
        h.element_id, h.object_id, h.strategy_id, h.portfolio_id, h.folder_id,
        coalesce(e.title, ob.name, s.name, p.name, fo.name) as owner_label,
        e.object_id as element_object_id,
        coalesce(eo.domain_id, ob.domain_id, fo.domain_id) as domain_id,
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
      left join folders fo on fo.id = h.folder_id
      where coalesce(d.activity_space_id, p.activity_space_id, fo.activity_space_id) = p_space
      order by coalesce(h.deleted_at, h.created_at) desc
    $b$
  $f$;
  execute 'grant execute on function public.space_attachments(uuid, boolean) to authenticated, service_role';

  -- ⌘K's file search reads space_attachments, so its result loses the two
  -- columns with it.
  execute 'drop function if exists public.search_attachments(uuid, text, integer)';
  execute $f$
    create function public.search_attachments(p_space uuid, p_query text, p_limit integer default 20)
    returns table (id uuid, name text, mime_type text, element_id uuid, object_id uuid, strategy_id uuid, portfolio_id uuid,
      folder_id uuid, owner_label text, element_object_id uuid, domain_id uuid, snippet text)
    language sql stable set search_path = public as $body$
      with q as (select '%' || replace(replace(replace(p_query, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' as pattern)
      select s.id, s.name, s.mime_type, s.element_id, s.object_id, s.strategy_id, s.portfolio_id, s.folder_id,
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
  execute 'grant execute on function public.search_attachments(uuid, text, integer) to authenticated, service_role';
end
$$;

-- 2. Element delete / restore ──────────────────────────────────────────────
do $$
begin
  if to_regclass('public.element_deletions') is null then
    raise notice 'remove_crm: element_deletions not present';
    return;
  end if;

  execute $f$
    create or replace function public.snapshot_element_before_delete()
    returns trigger language plpgsql security definer set search_path to 'public' as $b$
    declare
      v_name text;
      v_snapshot jsonb;
    begin
      if public.alcon_restoring() then return old; end if;
      select nullif(btrim(p.display_name), '') into v_name from public.profiles p where p.id = auth.uid();
      v_snapshot := jsonb_build_object(
        'element', to_jsonb(old),
        'subelements', coalesce((select jsonb_agg(to_jsonb(t)) from public.subelements t where t.element_id = old.id), '[]'::jsonb),
        'element_assignees', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_assignees t where t.element_id = old.id), '[]'::jsonb),
        'element_objects', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_objects t where t.element_id = old.id), '[]'::jsonb),
        'element_comments', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.element_comments t where t.element_id = old.id), '[]'::jsonb),
        'element_reactions', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_reactions t where t.element_id = old.id), '[]'::jsonb),
        'element_activity', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_activity t where t.element_id = old.id), '[]'::jsonb),
        'element_approvals', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_approvals t where t.element_id = old.id), '[]'::jsonb),
        'custom_column_values', coalesce((select jsonb_agg(to_jsonb(t)) from public.custom_column_values t where t.element_id = old.id), '[]'::jsonb),
        'element_edges', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_edges t where t.from_element = old.id or t.to_element = old.id), '[]'::jsonb)
      );
      insert into public.element_deletions (element_id, object_id, owner_id, title, display_id, snapshot, deleted_by, deleted_by_name)
      values (old.id, old.object_id, old.owner_id, coalesce(nullif(btrim(old.title), ''), 'Untitled'), old.display_id, v_snapshot, auth.uid(), v_name);
      return old;
    end $b$
  $f$;

  execute $f$
    create or replace function public.restore_element(p_deletion uuid)
    returns uuid language plpgsql security definer set search_path to 'public' as $b$
    declare
      v_del public.element_deletions%rowtype;
      v_el public.elements%rowtype;
      v_table text;
      v_name text;
      v_row jsonb;
      v_home boolean;
    begin
      select * into v_del from public.element_deletions where id = p_deletion;
      if not found or auth.uid() is null then
        raise exception 'This deleted Element is not yours to restore' using errcode = '42501';
      end if;
      v_home := v_del.object_id is not null and exists (select 1 from public.objects where id = v_del.object_id);
      if (v_home and not public.user_can_see_object(v_del.object_id))
         or (not v_home and not (coalesce(v_del.deleted_by = auth.uid(), false) or coalesce(v_del.owner_id = auth.uid(), false))) then
        raise exception 'This deleted Element is not yours to restore' using errcode = '42501';
      end if;
      if exists (select 1 from public.elements where id = v_del.element_id) then
        raise exception 'This Element is already back' using errcode = '23505';
      end if;
      perform set_config('alcon.restoring', 'on', true);
      v_el := jsonb_populate_record(null::public.elements, v_del.snapshot->'element');
      if not v_home then
        v_el.object_id := null;
        v_el.owner_id := auth.uid();
      end if;
      if exists (select 1 from public.elements e where e.object_id is not distinct from v_el.object_id and e.seq_number = v_el.seq_number) then
        v_el.seq_number := null;
      end if;
      insert into public.elements select v_el.*;
      foreach v_table in array array['subelements', 'element_objects', 'element_assignees', 'element_comments', 'element_reactions',
                                     'element_activity', 'element_approvals', 'custom_column_values', 'element_edges', 'intent_bindings'] loop
        if to_regclass('public.' || v_table) is null or jsonb_array_length(coalesce(v_del.snapshot->v_table, '[]'::jsonb)) = 0 then continue; end if;
        begin
          execute format('insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1) on conflict do nothing', v_table)
            using v_del.snapshot->v_table;
        exception when others then
          for v_row in select value from jsonb_array_elements(v_del.snapshot->v_table) loop
            begin
              execute format('insert into public.%1$I select * from jsonb_populate_record(null::public.%1$I, $1) on conflict do nothing', v_table) using v_row;
            exception when others then null;
            end;
          end loop;
        end;
      end loop;
      select nullif(btrim(p.display_name), '') into v_name from public.profiles p where p.id = auth.uid();
      insert into public.element_activity (element_id, kind, detail, author, actor_id, created_at)
      values (v_del.element_id, 'deleted', 'Deleted' || coalesce(' by ' || v_del.deleted_by_name, ''), coalesce(v_del.deleted_by_name, 'System'), v_del.deleted_by, v_del.deleted_at);
      perform set_config('alcon.restoring', '', true);
      insert into public.element_activity (element_id, kind, detail, author, actor_id, created_at)
      values (v_del.element_id, 'restored', 'Restored', coalesce(v_name, 'Member'), auth.uid(), clock_timestamp());
      delete from public.element_deletions where id = p_deletion;
      return v_del.element_id;
    end $b$
  $f$;
end
$$;

-- 3. Intents ────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.intents') is not null then
    execute 'drop trigger if exists intents_refresh_crm_measures on public.intents';
  end if;
  if to_regprocedure('public.intents_refresh_crm_measures()') is not null then
    execute 'drop function public.intents_refresh_crm_measures()';
  end if;

  if to_regclass('public.intent_bindings') is not null then
    execute $q$delete from public.intent_bindings where target_type = 'crm_deal'$q$;
    execute 'alter table public.intent_bindings drop constraint if exists intent_bindings_target_type_check';
    execute $q$alter table public.intent_bindings add constraint intent_bindings_target_type_check
      check (target_type in ('domain', 'object', 'element', 'phase', 'worker'))$q$;
  end if;

  if to_regclass('public.intent_measure_readings') is not null then
    execute $q$update public.intent_measure_readings set source = 'other' where source = 'crm'$q$;
    execute 'alter table public.intent_measure_readings drop constraint if exists intent_measure_readings_source_check';
    execute $q$alter table public.intent_measure_readings add constraint intent_measure_readings_source_check
      check (source in ('manual', 'copilot', 'api', 'mcp', 'agent', 'system', 'backfill', 'other'))$q$;

    execute $f$
      create or replace function public.intent_record_measure_reading()
      returns trigger language plpgsql security definer set search_path to 'public' as $b$
      declare
        v_source text;
        v_previous numeric;
        v_name text;
      begin
        if new.kind is distinct from 'measure' then return new; end if;
        if tg_op = 'INSERT' then
          if new.actual_value is null then return new; end if;
          v_previous := null;
        else
          -- A re-read of the same value with a new timestamp is a reading; a
          -- timestamp change with no value is not.
          if new.actual_value is not distinct from old.actual_value
             and (new.actual_value is null or new.measured_at is not distinct from old.measured_at) then
            return new;
          end if;
          v_previous := old.actual_value;
        end if;

        v_source := nullif(current_setting('alcon.reading_source', true), '');
        if v_source is null then
          begin
            v_source := nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-alcon-reading-source', '');
          exception when others then
            v_source := null;
          end;
        end if;
        v_source := lower(coalesce(v_source, case when auth.uid() is null then 'system' else 'other' end));
        if v_source not in ('manual', 'copilot', 'api', 'mcp', 'agent', 'system', 'other') then
          v_source := 'other';
        end if;

        -- A person's own human Worker (one per person, not tied to a Space) names them.
        if auth.uid() is not null then
          select w.name into v_name from public.workers w
            where w.user_id = auth.uid() and w.type = 'human' and w.object_id is null
            limit 1;
        end if;

        insert into public.intent_measure_readings
          (intent_id, value, previous_value, measured_at, target_value, direction, unit, source, recorded_by, recorded_by_name)
        values
          (new.id, new.actual_value, v_previous,
           case when new.actual_value is null then null else coalesce(new.measured_at, now()) end,
           new.target_value, new.direction, new.unit, v_source, auth.uid(), v_name);
        return new;
      end $b$
    $f$;
  end if;
end
$$;

-- 4. Domains ────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.domains') is not null then
    execute 'drop trigger if exists domains_crm_guard on public.domains';
  end if;
end
$$;

-- 5. CRM itself ─────────────────────────────────────────────────────────────
-- Nothing outside CRM depends on these tables any more, so CASCADE reaches
-- only CRM's own policies, triggers and foreign keys.
drop table if exists public.crm_deal_contacts cascade;
drop table if exists public.crm_element_links cascade;
drop table if exists public.crm_activities cascade;
drop table if exists public.crm_deals cascade;
drop table if exists public.crm_contacts cascade;
drop table if exists public.crm_companies cascade;
drop table if exists public.crm_fields cascade;
drop table if exists public.crm_pipelines cascade;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'crm\_%'
  loop
    execute format('drop function %s cascade', f);
  end loop;
end
$$;

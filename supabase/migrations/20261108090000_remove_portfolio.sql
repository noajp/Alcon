-- Strategy has two layers: Vision and Initiative. Initiatives nest
-- (strategy_children), so the bundle a Portfolio used to be is now a parent
-- Initiative, and Portfolio leaves Alcon:
--
--   1. Portfolios become Initiatives, keeping their id, name, description,
--      Vision and Space. Their nesting and their members become
--      strategy_children edges, and their attachments move to the Initiative.
--   2. strategies     the two triggers that read portfolio_id stop reading
--                     and watching it.
--   3. attachments    the four RLS policies and the one-owner check drop the
--                     Portfolio owner; space_attachments / search_attachments
--                     drop portfolio_id from their results and take a
--                     strategy attachment's Space from the Initiative itself;
--                     attachment_owner_visible drops the kind.
--   4. Portfolio itself: strategies.portfolio_id, the table and its functions.

-- 1. Portfolios → Initiatives ───────────────────────────────────────────────
do $$
begin
  if to_regclass('public.portfolios') is null or to_regclass('public.strategies') is null then
    raise notice 'remove_portfolio: portfolios or strategies not present';
    return;
  end if;

  execute $q$
    insert into public.strategies (id, name, description, created_by, created_at, updated_at, vision_id, activity_space_id)
    select p.id, p.name, p.description, coalesce(p.created_by, v.created_by), p.created_at, p.updated_at, p.vision_id, p.activity_space_id
    from public.portfolios p left join public.visions v on v.id = p.vision_id
    where coalesce(p.created_by, v.created_by) is not null
    on conflict (id) do nothing
  $q$;

  if to_regclass('public.strategy_children') is not null then
    execute $q$
      insert into public.strategy_children (parent_strategy_id, child_strategy_id, order_index)
      select p.parent_id, p.id, p.order_index from public.portfolios p
      where p.parent_id is not null
        and exists (select 1 from public.strategies s where s.id = p.parent_id)
        and exists (select 1 from public.strategies s where s.id = p.id)
      on conflict do nothing
    $q$;
    execute $q$
      insert into public.strategy_children (parent_strategy_id, child_strategy_id)
      select s.portfolio_id, s.id from public.strategies s
      where s.portfolio_id is not null
        and exists (select 1 from public.strategies x where x.id = s.portfolio_id)
      on conflict do nothing
    $q$;
  end if;

  if to_regclass('public.attachments') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'attachments' and column_name = 'portfolio_id') then
    execute $q$
      update public.attachments set strategy_id = portfolio_id, portfolio_id = null
      where portfolio_id is not null and exists (select 1 from public.strategies s where s.id = attachments.portfolio_id)
    $q$;
    execute 'delete from public.attachments where portfolio_id is not null';
  end if;
end
$$;

-- 2. Initiative triggers ────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.strategies') is null then
    raise notice 'remove_portfolio: strategies not present';
    return;
  end if;

  execute $f$
    create or replace function public.guard_strategy_vision()
    returns trigger language plpgsql set search_path to 'public', 'pg_catalog' as $b$
    declare
      vision_space uuid;
    begin
      if new.vision_id is not null and auth.uid() is not null
         and (tg_op = 'INSERT' or new.vision_id is distinct from old.vision_id) then
        select activity_space_id into vision_space from public.visions where id = new.vision_id;
        if vision_space is null or not public.is_activity_space_member(vision_space) then
          raise exception 'an Initiative is placed under a Vision of a Space you belong to' using errcode = '42501';
        end if;
      end if;
      return new;
    end;
    $b$
  $f$;

  execute $f$
    create or replace function public.strategies_follow_space()
    returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $b$
    declare
      v_space uuid;
    begin
      if new.vision_id is not null then
        select activity_space_id into v_space from public.visions where id = new.vision_id;
      end if;
      if v_space is not null then new.activity_space_id := v_space; end if;
      if tg_op = 'UPDATE' and new.activity_space_id is null then
        new.activity_space_id := old.activity_space_id;
      end if;
      return new;
    end;
    $b$
  $f$;

  -- Both fired on a portfolio_id change too; they now watch the Vision only.
  execute 'drop trigger if exists strategies_follow_space on public.strategies';
  execute 'create trigger strategies_follow_space before insert or update of vision_id, activity_space_id on public.strategies
    for each row execute function public.strategies_follow_space()';
  execute 'drop trigger if exists strategies_guard_vision on public.strategies';
  execute 'create trigger strategies_guard_vision before insert or update of vision_id on public.strategies
    for each row execute function public.guard_strategy_vision()';
end
$$;

-- 3. Attachments ────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.attachments') is null then
    raise notice 'remove_portfolio: attachments not present';
    return;
  end if;

  execute 'drop policy if exists attachments_select on public.attachments';
  execute 'drop policy if exists attachments_insert on public.attachments';
  execute 'drop policy if exists attachments_update on public.attachments';
  execute 'drop policy if exists attachments_delete on public.attachments';

  execute 'alter table public.attachments drop constraint if exists attachments_one_owner';
  execute 'alter table public.attachments drop column if exists portfolio_id';
  execute 'alter table public.attachments add constraint attachments_one_owner
    check (num_nonnulls(element_id, object_id, strategy_id, folder_id) = 1)';

  execute $p$
    create policy attachments_select on public.attachments for select to authenticated using (
      (element_id is not null and exists (select 1 from public.elements x where x.id = attachments.element_id))
      or (object_id is not null and exists (select 1 from public.objects x where x.id = attachments.object_id))
      or (strategy_id is not null and exists (select 1 from public.strategies x where x.id = attachments.strategy_id))
      or (folder_id is not null and exists (select 1 from public.folders x where x.id = attachments.folder_id)))
  $p$;
  execute $p$
    create policy attachments_insert on public.attachments for insert to authenticated with check (
      uploaded_by = (select auth.uid()) and (
        (element_id is not null and exists (select 1 from public.elements x where x.id = attachments.element_id))
        or (object_id is not null and exists (select 1 from public.objects x where x.id = attachments.object_id))
        or (strategy_id is not null and exists (select 1 from public.strategies x where x.id = attachments.strategy_id))
        or (folder_id is not null and exists (select 1 from public.folders x where x.id = attachments.folder_id))))
  $p$;
  execute $p$
    create policy attachments_update on public.attachments for update to authenticated using (
      (element_id is not null and exists (select 1 from public.elements x where x.id = attachments.element_id))
      or (object_id is not null and exists (select 1 from public.objects x where x.id = attachments.object_id))
      or (strategy_id is not null and exists (select 1 from public.strategies x where x.id = attachments.strategy_id))
      or (folder_id is not null and exists (select 1 from public.folders x where x.id = attachments.folder_id)))
    with check (
      ((element_id is not null and exists (select 1 from public.elements x where x.id = attachments.element_id))
      or (object_id is not null and exists (select 1 from public.objects x where x.id = attachments.object_id))
      or (strategy_id is not null and exists (select 1 from public.strategies x where x.id = attachments.strategy_id))
      or (folder_id is not null and exists (select 1 from public.folders x where x.id = attachments.folder_id)))
      and (deleted_by is null or deleted_by = (select auth.uid())))
  $p$;
  execute $p$
    create policy attachments_delete on public.attachments for delete to authenticated using (
      (((element_id is not null and exists (select 1 from public.elements x where x.id = attachments.element_id))
      or (object_id is not null and exists (select 1 from public.objects x where x.id = attachments.object_id))
      or (strategy_id is not null and exists (select 1 from public.strategies x where x.id = attachments.strategy_id))
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
        when 'folder' then exists (select 1 from public.folders x where x.id::text = owner)
        else false end, false)
    $b$
  $f$;

  -- search_attachments reads space_attachments, so both are recreated.
  execute 'drop function if exists public.search_attachments(uuid, text, integer)';
  execute 'drop function if exists public.space_attachments(uuid, boolean)';
  execute $f$
    create function public.space_attachments(p_space uuid, p_trashed boolean default false)
    returns table(id uuid, path text, name text, size bigint, mime_type text, uploaded_by uuid,
      created_at timestamptz, deleted_at timestamptz, previous_id uuid, element_id uuid, object_id uuid,
      strategy_id uuid, folder_id uuid, owner_label text, element_object_id uuid,
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
        h.element_id, h.object_id, h.strategy_id, h.folder_id,
        coalesce(e.title, ob.name, s.name, fo.name) as owner_label,
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
      left join folders fo on fo.id = h.folder_id
      where coalesce(d.activity_space_id, s.activity_space_id, fo.activity_space_id) = p_space
      order by coalesce(h.deleted_at, h.created_at) desc
    $b$
  $f$;
  execute 'grant execute on function public.space_attachments(uuid, boolean) to authenticated, service_role';

  execute $f$
    create function public.search_attachments(p_space uuid, p_query text, p_limit integer default 20)
    returns table (id uuid, name text, mime_type text, element_id uuid, object_id uuid, strategy_id uuid,
      folder_id uuid, owner_label text, element_object_id uuid, domain_id uuid, snippet text)
    language sql stable set search_path = public as $body$
      with q as (select '%' || replace(replace(replace(p_query, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' as pattern)
      select s.id, s.name, s.mime_type, s.element_id, s.object_id, s.strategy_id, s.folder_id,
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

-- 4. Portfolio itself ───────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.strategies') is not null then
    execute 'alter table public.strategies drop column if exists portfolio_id';
  end if;
end
$$;

drop table if exists public.portfolios cascade;
drop function if exists public.guard_portfolio_parent() cascade;
drop function if exists public.propagate_portfolio_vision() cascade;

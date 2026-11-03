-- A Sub-element is an Element with a parent: it has its own page, description,
-- properties, comments and activity, like any Element, and lives in its
-- parent's Object. elements.parent_id points at the parent (deleted with
-- it); a chain of parents never loops. The separate subelements table, its
-- triggers, and its place in the read functions and the delete snapshot go.
do $$
declare
  f text;
  d text;
begin
  if to_regclass('public.elements') is null then
    raise notice 'subelements_as_elements skipped: elements is not present'; return;
  end if;

  alter table public.elements add column if not exists parent_id uuid references public.elements(id) on delete cascade;
  create index if not exists elements_parent_id_idx on public.elements(parent_id) where parent_id is not null;
  if not exists (select 1 from pg_constraint where conname = 'elements_parent_not_self') then
    alter table public.elements add constraint elements_parent_not_self check (parent_id is null or parent_id <> id);
  end if;

  -- The read functions and the delete snapshot stop reading subelements.
  foreach f in array array[
    'public.get_explorer_data(uuid,uuid)', 'public.get_my_elements()', 'public.get_now_work(uuid)',
    'public.snapshot_element_before_delete()', 'public.restore_element(uuid)', 'public.set_element_display_id()'
  ] loop
    if to_regprocedure(f) is null then continue; end if;
    d := pg_get_functiondef(to_regprocedure(f));
    -- a jsonb entry: 'subelements', coalesce((select … from [public.]subelements x where x.element_id = y.id), '[]'::jsonb)
    d := regexp_replace(d, '''subelements'',\s*coalesce\(\(\s*select jsonb_agg\([^;]*?from (public\.)?subelements \w+ where \w+\.element_id\s*=\s*\w+\.id\s*\),\s*''\[\]''::jsonb\),', '', 'g');
    d := regexp_replace(d, ',\s*''subelements'',\s*coalesce\(\(\s*select jsonb_agg\([^;]*?from (public\.)?subelements \w+ where \w+\.element_id\s*=\s*\w+\.id\s*\),\s*''\[\]''::jsonb\)', '', 'g');
    -- the next number also counted Sub-elements
    d := regexp_replace(d, ',\s*coalesce\(\(select max\(s\.seq_number\) from public\.subelements s[^;]*?new\.object_id\), 0\)', '', 'g');
    d := replace(d, 'array[''subelements'', ', 'array[');
    d := replace(d, 'element_objects, subelements,', 'element_objects,');
    if d ~ 'subelements' then
      raise exception 'subelements_as_elements: % still reads subelements', f;
    end if;
    execute d;
  end loop;

  if to_regclass('public.subelements') is not null then
    if exists (select 1 from public.subelements) then
      raise exception 'subelements_as_elements: subelements still holds rows; move them to Elements first';
    end if;
    drop table public.subelements;
  end if;
  drop function if exists public.set_subelement_display_id();
  drop function if exists public.rollup_subelement_progress();
  drop function if exists public.sync_subelement_status();
end $$;

-- A parent chain never loops: an Element cannot sit under one of its own
-- Sub-elements.
do $$
begin
  if to_regclass('public.elements') is null then return; end if;
  execute $f$
    create or replace function public.check_element_parent() returns trigger
    language plpgsql set search_path = public as $body$
    begin
      if new.parent_id is null then return new; end if;
      if exists (
        with recursive up as (
          select e.id, e.parent_id from public.elements e where e.id = new.parent_id
          union all
          select e.id, e.parent_id from public.elements e join up on e.id = up.parent_id
        )
        select 1 from up where up.id = new.id
      ) then
        raise exception 'An Element cannot sit under one of its own Sub-elements' using errcode = '23514';
      end if;
      return new;
    end $body$
  $f$;
  drop trigger if exists elements_check_parent on public.elements;
  create trigger elements_check_parent before insert or update of parent_id on public.elements
    for each row execute function public.check_element_parent();
end $$;

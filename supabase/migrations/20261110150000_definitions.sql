-- Definitions: how a goal is to be carried out, written once by a person and
-- followed by the engine — the purpose, the conditions, the metric a loop
-- improves, one round of the procedure, when to stop, what to check, and
-- (when the result is a file) the shape of the output. A definition is a
-- Markdown document with known headings; the engine reads the headings, the
-- agent follows the text. It lives in a Space's library and is attached to a
-- Strategy (for all its Elements) or to an Element (which wins).
--
--   definitions                 members of the Space read and write; the
--                               author or a Space owner deletes.
--   strategies.definition_id    the definition its Elements follow.
--   elements.definition_id      this Element's own, over its Strategy's.
--   run_iterations              one row per round of a loop: the metric's
--                               value, what changed, kept or reverted.
--                               Readable through the run's Element; written
--                               by run-agent.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.activity_spaces') is null or to_regclass('public.elements') is null
     or to_regclass('public.strategies') is null or to_regclass('public.agent_runs') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'definitions skipped: base tables or the Space helpers not present';
    return;
  end if;

  -- A first cut of output-only templates, never used, gives way to definitions.
  execute 'alter table public.elements drop column if exists output_template_id';
  execute 'drop table if exists public.output_templates';

  execute $ddl$
    create table if not exists public.definitions (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      name text not null check (char_length(btrim(name)) between 1 and 120),
      body text not null check (char_length(body) between 1 and 200000),
      created_by uuid default auth.uid(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists definitions_space_idx on public.definitions (activity_space_id, name)';
  execute 'alter table public.definitions enable row level security';
  execute 'revoke all on table public.definitions from public, anon';
  execute 'grant select, insert, update, delete on public.definitions to authenticated';
  execute 'drop policy if exists definitions_select on public.definitions';
  execute 'create policy definitions_select on public.definitions for select to authenticated using (public.is_activity_space_member(activity_space_id))';
  execute 'drop policy if exists definitions_insert on public.definitions';
  execute 'create policy definitions_insert on public.definitions for insert to authenticated with check (public.is_activity_space_member(activity_space_id) and created_by = auth.uid())';
  execute 'drop policy if exists definitions_update on public.definitions';
  execute 'create policy definitions_update on public.definitions for update to authenticated using (public.is_activity_space_member(activity_space_id)) with check (public.is_activity_space_member(activity_space_id))';
  execute 'drop policy if exists definitions_delete on public.definitions';
  execute 'create policy definitions_delete on public.definitions for delete to authenticated using (created_by = auth.uid() or public.is_activity_space_owner(activity_space_id))';

  execute 'alter table public.strategies add column if not exists definition_id uuid references public.definitions(id) on delete set null';
  execute 'alter table public.elements add column if not exists definition_id uuid references public.definitions(id) on delete set null';

  execute $ddl$
    create table if not exists public.run_iterations (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references public.agent_runs(id) on delete cascade,
      element_id uuid not null references public.elements(id) on delete cascade,
      n integer not null check (n >= 1),
      value double precision,
      change text,
      kept boolean,
      note text,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists run_iterations_element_idx on public.run_iterations (element_id, created_at)';
  execute 'alter table public.run_iterations enable row level security';
  execute 'revoke all on table public.run_iterations from public, anon, authenticated';
  execute 'grant select on public.run_iterations to authenticated';
  execute 'drop policy if exists run_iterations_select on public.run_iterations';
  -- Whoever can see the Element sees its rounds (the Element's own RLS answers).
  execute 'create policy run_iterations_select on public.run_iterations for select to authenticated using (exists (select 1 from public.elements e where e.id = element_id))';
end $$;

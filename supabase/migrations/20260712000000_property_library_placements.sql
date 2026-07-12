-- Property library & placements (Asana-style custom fields).
--
-- Values already live on the Element (custom_column_values.element_id) — the
-- Asana invariant "one value per task, visible from every list it's homed in".
-- What was missing is the definition side: custom_columns.object_id fused
-- "who owns the definition" with "which list shows it". This migration
-- separates them:
--
--   custom_columns gains two scope axes (exactly one of four is set):
--     object_id         → local column (single Object, as before)
--     domain_id         → Object-tagging axis (unchanged, different feature)
--     activity_space_id → Space library column (Asana "global field")
--     owner_user_id     → personal column (My Elements private field)
--
--   custom_column_placements: which Element list a column appears on — an
--   Object's Elements list (object_id) or a user's My Elements
--   (owner_user_id). Library columns get one row per list they're added to;
--   local columns get a self-placement (backfilled below).
--
-- Personal (owner-scoped) column definitions are private: the blanket RLS
-- policy is replaced with one that hides other users' owner rows. Values are
-- meaningless without their definition, so value rows keep the existing
-- broad policy for now.
--
-- Guarded with to_regclass: preview branches replay supabase/migrations/ on
-- an EMPTY database (the base schema lives outside this folder), so the whole
-- block must no-op when the base tables are missing.

do $$
begin
  if to_regclass('public.custom_columns') is null
     or to_regclass('public.activity_spaces') is null
     or to_regclass('public.objects') is null then
    raise notice 'base tables missing - skipping property library migration (preview replay)';
    return;
  end if;

  -- ── custom_columns: new definition scopes ─────────────────────────────
  alter table public.custom_columns
    add column if not exists activity_space_id uuid references public.activity_spaces(id) on delete cascade;
  alter table public.custom_columns
    add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

  alter table public.custom_columns drop constraint if exists custom_columns_scope_check;
  alter table public.custom_columns add constraint custom_columns_scope_check check (
    ((object_id is not null)::int
     + (domain_id is not null)::int
     + (activity_space_id is not null)::int
     + (owner_user_id is not null)::int) = 1
  );

  create index if not exists idx_custom_columns_space
    on public.custom_columns(activity_space_id) where activity_space_id is not null;
  create index if not exists idx_custom_columns_owner
    on public.custom_columns(owner_user_id) where owner_user_id is not null;

  -- Owner-scoped definitions are visible only to their owner; every other
  -- scope keeps the previous authenticated-full-access behaviour.
  drop policy if exists "Authenticated full access" on public.custom_columns;
  drop policy if exists "Property columns access" on public.custom_columns;
  create policy "Property columns access" on public.custom_columns
    for all
    using (auth.uid() is not null and (owner_user_id is null or owner_user_id = auth.uid()))
    with check (auth.uid() is not null and (owner_user_id is null or owner_user_id = auth.uid()));

  -- ── placements ────────────────────────────────────────────────────────
  if to_regclass('public.custom_column_placements') is null then
    create table public.custom_column_placements (
      id uuid primary key default gen_random_uuid(),
      column_id uuid not null references public.custom_columns(id) on delete cascade,
      object_id uuid references public.objects(id) on delete cascade,
      owner_user_id uuid references auth.users(id) on delete cascade,
      order_index integer,
      created_at timestamptz default now(),
      constraint custom_column_placements_target_check check (
        ((object_id is not null)::int + (owner_user_id is not null)::int) = 1
      )
    );

    create unique index custom_column_placements_col_object_key
      on public.custom_column_placements(column_id, object_id) where object_id is not null;
    create unique index custom_column_placements_col_owner_key
      on public.custom_column_placements(column_id, owner_user_id) where owner_user_id is not null;
    create index idx_custom_column_placements_object
      on public.custom_column_placements(object_id) where object_id is not null;
    create index idx_custom_column_placements_owner
      on public.custom_column_placements(owner_user_id) where owner_user_id is not null;

    alter table public.custom_column_placements enable row level security;
    create policy "Property placements access" on public.custom_column_placements
      for all
      using (auth.uid() is not null and (owner_user_id is null or owner_user_id = auth.uid()))
      with check (auth.uid() is not null and (owner_user_id is null or owner_user_id = auth.uid()));

    -- Backfill: every local (object-scoped) column shows on its own Object.
    insert into public.custom_column_placements (column_id, object_id)
    select id, object_id from public.custom_columns where object_id is not null;
  end if;
end $$;

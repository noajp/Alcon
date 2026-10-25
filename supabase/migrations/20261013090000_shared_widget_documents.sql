-- What a widget holds of its own lives beside it and follows its visibility
-- (ADR 0040). A document part is shared by everyone who can see the widget and
-- merged key by key; viewer state is one person's own, such as a draft.
do $migration$
begin
  if to_regclass('public.widgets') is null then
    raise notice 'Widget documents skipped: widgets not present';
    return;
  end if;

  execute $ddl$
    create table public.widget_documents (
      widget_id uuid not null references public.widgets(id) on delete cascade,
      part text not null check (length(part) between 1 and 60),
      value jsonb not null default '{}'::jsonb
        check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 400000),
      revision integer not null default 1,
      updated_by uuid default auth.uid(),
      updated_at timestamptz not null default now(),
      primary key (widget_id, part)
    );
    create table public.widget_viewer_state (
      widget_id uuid not null references public.widgets(id) on delete cascade,
      user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
      value jsonb not null default '{}'::jsonb
        check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 200000),
      updated_at timestamptz not null default now(),
      primary key (widget_id, user_id)
    );

    alter table public.widget_documents enable row level security;
    alter table public.widget_viewer_state enable row level security;
    revoke all on public.widget_documents, public.widget_viewer_state from anon;
    grant select, insert, update, delete on public.widget_documents, public.widget_viewer_state to authenticated;
    grant all on public.widget_documents, public.widget_viewer_state to service_role;

    create policy widget_documents_by_widget on public.widget_documents for all to authenticated
      using (exists (select 1 from public.widgets w where w.id = widget_id))
      with check (exists (select 1 from public.widgets w where w.id = widget_id));
    create policy widget_viewer_state_own on public.widget_viewer_state for all to authenticated
      using (user_id = (select auth.uid()) and exists (select 1 from public.widgets w where w.id = widget_id))
      with check (user_id = (select auth.uid()) and exists (select 1 from public.widgets w where w.id = widget_id));

    -- Sets and removes top-level keys in one statement, so two people saving
    -- different keys at once both keep theirs. The same key: the later wins.
    create function public.merge_widget_document(
      p_widget_id uuid, p_part text, p_set jsonb default '{}'::jsonb, p_unset text[] default '{}'
    ) returns public.widget_documents language plpgsql set search_path = '' as $fn$
    declare v_row public.widget_documents;
    begin
      if jsonb_typeof(p_set) is distinct from 'object' then raise exception 'A patch must be an object'; end if;
      insert into public.widget_documents as d (widget_id, part, value)
        values (p_widget_id, p_part, p_set)
        on conflict (widget_id, part) do update
          set value = (d.value - coalesce(p_unset, '{}')) || excluded.value,
              revision = d.revision + 1,
              updated_at = now(),
              updated_by = (select auth.uid())
        returning * into v_row;
      return v_row;
    end $fn$;
    revoke all on function public.merge_widget_document(uuid, text, jsonb, text[]) from public, anon;
    grant execute on function public.merge_widget_document(uuid, text, jsonb, text[]) to authenticated, service_role;
  $ddl$;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.widget_documents';
  end if;

  -- Generated apps kept their source and inputs per owner here. They are
  -- widget documents now; the tables go once they hold nothing.
  if to_regclass('public.widget_apps') is not null then
    if exists (select 1 from public.widget_apps) then
      raise notice 'widget_apps kept: it still holds rows';
    else
      execute 'drop table if exists public.widget_app_data';
      execute 'drop table public.widget_apps';
      execute 'drop function if exists public.widget_app_revision()';
    end if;
  end if;
end $migration$;

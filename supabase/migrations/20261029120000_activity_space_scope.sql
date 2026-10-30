-- What a Space shows (ADR 0048): 'full' — Strategy, Execution and every
-- tool — or 'audit' — the Space, its People and the AI Audit, nothing else.
-- A Space that starts as an audit of AI work opens the rest by switching to
-- full; no data moves either way. Only the Space's owner changes it (the
-- existing activity_spaces_update policy), and not through a delegated call.
-- Guarded for preview replay: activity_spaces may be absent.
do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regprocedure('public.is_delegated_request()') is null then
    raise notice 'activity_space_scope skipped: activity_spaces or is_delegated_request not present';
    return;
  end if;

  execute 'alter table public.activity_spaces add column if not exists scope text not null default ''full''';
  if not exists (select 1 from pg_constraint where conname = 'activity_spaces_scope_check' and conrelid = 'public.activity_spaces'::regclass) then
    execute 'alter table public.activity_spaces add constraint activity_spaces_scope_check check (scope in (''audit'', ''full''))';
  end if;

  -- An outside agent acting for the owner (a personal access token or an
  -- OAuth grant) never widens what the Space shows.
  execute $fn$
    create or replace function public.activity_space_scope_guard()
    returns trigger language plpgsql set search_path = public as $b$
    begin
      if new.scope is distinct from old.scope and public.is_delegated_request() then
        raise exception 'a Space''s scope is changed only by its owner, signed in themselves';
      end if;
      return new;
    end;
    $b$
  $fn$;
  execute 'drop trigger if exists activity_space_scope_guard on public.activity_spaces';
  execute 'create trigger activity_space_scope_guard before update of scope on public.activity_spaces for each row execute function public.activity_space_scope_guard()';
end $$;

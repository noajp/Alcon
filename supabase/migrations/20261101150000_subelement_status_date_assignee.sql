-- SubElements read like list rows: a status, a due date and one assignee.
-- `status` and the existing `is_completed` stay in step (Done ⇔ completed),
-- so the progress rollup onto the parent Element keeps reading
-- is_completed, and now also fires when only the status is written.
do $$
begin
  if to_regclass('public.subelements') is null or to_regclass('public.workers') is null then
    raise notice 'subelement fields skipped: subelements or workers not present'; return;
  end if;

  execute 'alter table public.subelements
    add column if not exists status text not null default ''todo''
      check (status in (''backlog'', ''todo'', ''in_progress'', ''review'', ''done'', ''blocked'', ''cancelled'')),
    add column if not exists due_date date,
    add column if not exists assignee_id uuid references public.workers(id) on delete set null';
  execute 'update public.subelements set status = ''done'' where is_completed and status <> ''done''';

  execute $f$
    create or replace function public.sync_subelement_status()
    returns trigger
    language plpgsql
    set search_path = ''
    as $body$
    begin
      if tg_op = 'INSERT' then
        if new.status = 'done' then new.is_completed := true;
        elsif coalesce(new.is_completed, false) then new.status := 'done';
        end if;
        return new;
      end if;
      if new.status is distinct from old.status then
        new.is_completed := new.status = 'done';
      elsif new.is_completed is distinct from old.is_completed then
        new.status := case when new.is_completed then 'done' else 'todo' end;
      end if;
      return new;
    end
    $body$
  $f$;
  execute 'drop trigger if exists subelements_sync_status on public.subelements';
  execute 'create trigger subelements_sync_status before insert or update of status, is_completed on public.subelements
    for each row execute function public.sync_subelement_status()';

  if to_regprocedure('alcon_internal.rollup_subelement_progress()') is not null then
    execute 'drop trigger if exists subelements_rollup_progress on public.subelements';
    execute 'create trigger subelements_rollup_progress
      after insert or delete or update of is_completed, status, element_id on public.subelements
      for each row execute function alcon_internal.rollup_subelement_progress()';
  end if;
end $$;

-- An Element with SubElements takes its progress from them: the share
-- checked off, saved on the Element so every reader (lists, Decision Lab,
-- the API, the AI) sees the same number. All checked off makes it Done;
-- unchecking one of a Done Element's SubElements puts it back in progress.
-- A cancelled Element is left as it is.
do $$
begin
  if to_regclass('public.subelements') is null or to_regclass('public.elements') is null
     or to_regnamespace('alcon_internal') is null then
    raise notice 'subelement progress rollup skipped: subelements, elements or alcon_internal not present'; return;
  end if;

  execute $f$
    create or replace function alcon_internal.rollup_subelement_progress()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      v_element uuid;
      v_total int;
      v_done int;
      v_pct int;
    begin
      for v_element in
        select distinct x from unnest(array[
          case when tg_op <> 'INSERT' then old.element_id end,
          case when tg_op <> 'DELETE' then new.element_id end
        ]) as x where x is not null
      loop
        select count(*), count(*) filter (where is_completed)
          into v_total, v_done
          from public.subelements where element_id = v_element;
        if v_total = 0 then continue; end if;
        v_pct := round(v_done * 100.0 / v_total);
        update public.elements e set
          progress = v_pct,
          status = case
            when v_pct = 100 then 'done'
            when e.status = 'done' then case when v_pct > 0 then 'in_progress' else 'todo' end
            when e.status in ('backlog', 'todo') and v_pct > 0 then 'in_progress'
            else e.status
          end,
          updated_at = now()
        where e.id = v_element
          and e.status is distinct from 'cancelled'
          and (e.progress is distinct from v_pct
               or (v_pct = 100 and e.status is distinct from 'done')
               or (v_pct < 100 and e.status = 'done')
               or (v_pct > 0 and e.status in ('backlog', 'todo')));
      end loop;
      return null;
    end
    $body$
  $f$;

  execute 'drop trigger if exists subelements_rollup_progress on public.subelements';
  execute 'create trigger subelements_rollup_progress
    after insert or delete or update of is_completed, element_id on public.subelements
    for each row execute function alcon_internal.rollup_subelement_progress()';
end $$;

-- A deal's history keeps its revisions, not only its stage moves: a change to
-- the amount, the probability or the expected close date is written by the
-- database as a 'change' row ("field: old → new"), with who made it, and
-- stage rows carry the name of who moved the deal as well. Like
-- stage rows, these are written only by the database and cannot be deleted.
-- A probability that moves with the stage in the same write is not repeated.
do $$
begin
  if to_regclass('public.crm_deals') is null
     or to_regclass('public.crm_activities') is null
     or to_regprocedure('public.crm_activity_visible(uuid, uuid, uuid, uuid)') is null then
    raise notice 'crm deal change history skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  alter table public.crm_activities drop constraint if exists crm_activities_kind_check;
  alter table public.crm_activities add constraint crm_activities_kind_check
    check (kind in ('call','email','meeting','note','stage','change'));

  drop policy if exists crm_activities_write on public.crm_activities;
  drop policy if exists crm_activities_delete on public.crm_activities;
  create policy crm_activities_write on public.crm_activities for insert to authenticated
    with check (public.crm_activity_visible(activity_space_id, deal_id, company_id, contact_id) and kind not in ('stage','change'));
  create policy crm_activities_delete on public.crm_activities for delete to authenticated
    using (public.crm_activity_visible(activity_space_id, deal_id, company_id, contact_id) and created_by = auth.uid() and kind not in ('stage','change'));

  create or replace function public.crm_log_stage() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_company uuid;
    v_author text;
    v_rows text[][] := array[]::text[][];
    v_row text[];
  begin
    if new.stage is distinct from old.stage then
      v_rows := v_rows || array[['stage', old.stage || ' → ' || new.stage]];
    end if;
    if new.amount is distinct from old.amount or (new.amount is not null and new.currency is distinct from old.currency) then
      v_rows := v_rows || array[['change', 'amount: '
        || coalesce(trim_scale(old.amount)::text || ' ' || coalesce(old.currency, ''), '—') || ' → '
        || coalesce(trim_scale(new.amount)::text || ' ' || coalesce(new.currency, ''), '—')]];
    end if;
    if new.probability is distinct from old.probability and new.stage is not distinct from old.stage then
      v_rows := v_rows || array[['change', 'probability: ' || coalesce(old.probability::text, '—') || ' → ' || coalesce(new.probability::text, '—')]];
    end if;
    if new.close_date is distinct from old.close_date then
      v_rows := v_rows || array[['change', 'close_date: ' || coalesce(old.close_date::text, '—') || ' → ' || coalesce(new.close_date::text, '—')]];
    end if;
    if coalesce(array_length(v_rows, 1), 0) = 0 then return new; end if;

    -- Name the company only when everyone who can see the deal can see it.
    select c.id into v_company
      from public.crm_companies c join public.crm_pipelines p on p.id = new.pipeline_id
      where c.id = new.company_id and (c.domain_id is null or c.domain_id is not distinct from p.domain_id);
    select w.name into v_author from public.workers w
      where w.user_id = auth.uid() and w.type = 'human'
      order by (w.activity_space_id = new.activity_space_id) desc nulls last limit 1;
    foreach v_row slice 1 in array v_rows loop
      insert into public.crm_activities (activity_space_id, deal_id, company_id, kind, body, occurred_on, created_by, author_name)
      values (new.activity_space_id, new.id, v_company, v_row[1], v_row[2], current_date, auth.uid(), v_author);
    end loop;
    return new;
  end $fn$;

  drop trigger if exists crm_deals_log_stage on public.crm_deals;
  create trigger crm_deals_log_stage after update of stage, amount, currency, probability, close_date on public.crm_deals
    for each row execute function public.crm_log_stage();
  $ddl$;
end $$;

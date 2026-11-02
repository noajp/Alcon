-- intent_bindings points at its target by (target_type, target_id), which no
-- foreign key can guard, so deleting a Domain, Object, Element, Phase, Worker
-- or deal left bindings to nothing (ELE_OBJ-008). Each of those tables now
-- removes the bindings that pointed at a deleted row.
do $mig$
declare
  t record;
begin
  if to_regclass('public.intent_bindings') is null then
    raise notice 'intent_bindings_follow_targets skipped: intent_bindings not present'; return;
  end if;

  execute $f$
    create or replace function public.intent_bindings_drop_target()
    returns trigger language plpgsql security definer set search_path = public, pg_temp as $b$
    begin
      delete from public.intent_bindings where target_type = tg_argv[0] and target_id = old.id;
      return old;
    end;
    $b$
  $f$;
  execute 'revoke execute on function public.intent_bindings_drop_target() from public, anon, authenticated';

  for t in select * from (values
    ('domains', 'domain'), ('objects', 'object'), ('elements', 'element'),
    ('phases', 'phase'), ('workers', 'worker'), ('crm_deals', 'crm_deal')) v(tbl, kind)
  loop
    if to_regclass('public.' || t.tbl) is null then continue; end if;
    execute format('drop trigger if exists intent_bindings_drop_target on public.%I', t.tbl);
    execute format('create trigger intent_bindings_drop_target after delete on public.%I
      for each row execute function public.intent_bindings_drop_target(%L)', t.tbl, t.kind);
  end loop;

  -- Bindings already left pointing at nothing, for whichever target tables
  -- exist (dynamic, so an absent table is skipped rather than an error).
  for t in select * from (values
    ('domains', 'domain'), ('objects', 'object'), ('elements', 'element'),
    ('phases', 'phase'), ('workers', 'worker'), ('crm_deals', 'crm_deal')) v(tbl, kind)
  loop
    if to_regclass('public.' || t.tbl) is null then continue; end if;
    execute format('delete from public.intent_bindings ib where ib.target_type = %L
      and not exists (select 1 from public.%I x where x.id = ib.target_id)', t.kind, t.tbl);
  end loop;
end $mig$;

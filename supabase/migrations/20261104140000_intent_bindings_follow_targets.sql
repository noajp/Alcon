-- intent_bindings points at its target by (target_type, target_id), which no
-- foreign key can guard, so deleting a Domain, Object, Element, Phase, Worker
-- or deal left bindings to nothing (ELE_OBJ-008). Each of those tables now
-- removes the bindings that pointed at a deleted row — an Element's go into
-- its deletion snapshot first, and restore_element puts them back.
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
      -- A deleted Element can be restored (restore_element): keep its
      -- bindings in the snapshot its deletion just wrote, so they come back.
      if tg_argv[0] = 'element' and to_regclass('public.element_deletions') is not null then
        update public.element_deletions d
           set snapshot = d.snapshot || jsonb_build_object('intent_bindings',
                 (select coalesce(jsonb_agg(to_jsonb(ib)), '[]'::jsonb) from public.intent_bindings ib
                   where ib.target_type = 'element' and ib.target_id = old.id))
         where d.id = (select id from public.element_deletions
                        where element_id = old.id order by deleted_at desc limit 1);
      end if;
      delete from public.intent_bindings where target_type = tg_argv[0] and target_id = old.id;
      return old;
    end;
    $b$
  $f$;
  execute 'revoke execute on function public.intent_bindings_drop_target() from public, anon, authenticated';

  -- restore_element brings back the tables its snapshot lists; add the
  -- bindings to that list.
  if to_regprocedure('public.restore_element(uuid)') is not null
     and position('''intent_bindings''' in pg_get_functiondef('public.restore_element(uuid)'::regprocedure)) = 0 then
    execute replace(pg_get_functiondef('public.restore_element(uuid)'::regprocedure),
                    '''crm_element_links'']', '''crm_element_links'', ''intent_bindings'']');
  end if;

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

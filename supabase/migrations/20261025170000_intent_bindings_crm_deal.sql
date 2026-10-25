-- An Initiative's assumption can rest on a customer, not only on work or a
-- person: "the large customer renews", "the broker stays reliable". A binding
-- may point at a CRM deal; the assumption is shaken when that deal is lost,
-- at risk, past its close date, or late for renewal. The deal is read with the
-- reader's own rights, so a reader who cannot see it sees the link, not the deal.
do $$
begin
  if to_regclass('public.intent_bindings') is null then
    raise notice 'intent bindings crm deal skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  alter table public.intent_bindings drop constraint if exists intent_bindings_target_type_check;
  alter table public.intent_bindings add constraint intent_bindings_target_type_check
    check (target_type in ('domain', 'object', 'element', 'phase', 'worker', 'crm_deal'));
  $ddl$;
end $$;

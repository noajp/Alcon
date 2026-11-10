-- Promotion drafts gain a third source kind: 'builder' (Automation
-- builder PR4; design §5.4). A draft the Automation builder creates
-- — seeded from the zone picks for a new automation, or opened
-- against a live automation's definition as a trigger-less update —
-- has no memory or run behind it: its source is the builder itself,
-- and the seed it carries (name, body, binding) is written on the
-- row at insert. Everything else about the draft is unchanged: the
-- open-draft caps count rows per Space and per requester regardless
-- of kind, the one-open-draft-per-target index already covers
-- builder update drafts, and activation stays the owner's RPC,
-- bound to the tested hashes exactly as for the other sources.
--
-- The widening restates the source_kind CHECK whole, in the standing
-- style: whatever check constraint on the column stands today is
-- dropped by definition (its name is the column's, but a preview
-- database may carry it under the inline default), and the widened
-- one is laid down under the canonical name.
--
-- Guarded for preview replay (the base schema lives outside this
-- folder), like every migration here.
--
-- NOTE for whoever applies migrations centrally: this file must be
-- applied to production BEFORE any web build that creates builder
-- drafts ships — until it lands, a 'builder' insert is refused by
-- the standing ('memory', 'run') check.

do $$
declare
  v_conname text;
begin
  if to_regclass('public.promotion_drafts') is null then
    raise notice 'promotion builder source skipped: promotion_drafts not present';
    return;
  end if;

  for v_conname in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.promotion_drafts'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%source_kind%'
  loop
    execute format('alter table public.promotion_drafts drop constraint %I', v_conname);
  end loop;

  alter table public.promotion_drafts
    add constraint promotion_drafts_source_kind_check
    check (source_kind in ('memory', 'run', 'builder'));
end $$;

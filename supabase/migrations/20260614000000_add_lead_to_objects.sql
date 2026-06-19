-- Objects gain a `lead_id` — the Object's "Lead" (responsible Worker), shown and
-- editable inline from the Object list's Lead column. Mirrors how Elements carry
-- assignees, but an Object has a single Lead.
--
-- Named `lead_id` (NOT `owner_id`) on purpose: elements.owner_id already means
-- something different (the auth.users personal owner that scopes "My Elements").
-- An Object's Lead is a Worker in the Domain, so this FKs public.workers(id).
-- Nullable; no backfill.
--
-- Guarded like the due_date / progress migrations: if public.objects isn't
-- present yet (a fresh preview branch replaying the migrations folder, where the
-- base schema lives outside the migrations history), this becomes a no-op
-- instead of erroring with 42P01 "relation public.objects does not exist".

do $$
begin
  if to_regclass('public.objects') is null then
    raise notice 'objects.lead_id migration skipped: objects not present';
    return;
  end if;

  execute 'alter table public.objects add column if not exists lead_id uuid references public.workers(id) on delete set null';
end
$$;

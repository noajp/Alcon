-- elements.labels must be a JSON array.
--
-- Every reader iterates it (`for (const l of el.labels ?? [])`). A row whose
-- labels was a JSON object ('{}' written through SQL) reached the client
-- through the explorer cache and crashed the whole shell — and the persisted
-- query cache kept the crash across reloads. The column is jsonb, so nothing
-- stopped it. Refuse anything but an array.

do $$
begin
  if to_regclass('public.elements') is null then
    raise notice 'elements_labels_array skipped: elements not present'; return;
  end if;
  update public.elements set labels = '[]'::jsonb
    where labels is not null and jsonb_typeof(labels) <> 'array';
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.elements'::regclass and conname = 'elements_labels_is_array'
  ) then
    execute 'alter table public.elements add constraint elements_labels_is_array
             check (labels is null or jsonb_typeof(labels) = ''array'')';
  end if;
end $$;

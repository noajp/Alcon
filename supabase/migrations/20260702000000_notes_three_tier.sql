-- Bring the notes schema up to the 3-tier model the app is written against
-- (types/notes.ts, useNotesDb, NotesSidebar):
--
--   notebook (Cabinet, root) → folder → file
--
-- The live constraints only knew the older 2-tier shape (folder at root,
-- file inside folder), so every notebook INSERT — including the App Guide
-- onboarding seed and NotesSidebar's "New Cabinet" — failed with
-- notes_type_check / notes_parent_rules violations.
--
-- Changes:
--   1. notes_type_check      → allow 'notebook' | 'folder' | 'file'
--   2. notes_parent_rules    → notebook ⇒ no parent; folder/file ⇒ parent required
--   3. backfill              → existing root folders get a per-user "My Notes"
--                              Cabinet and are reparented under it
--   4. linked_domain_id      → column the code reads/writes for the
--                              Cabinet → Domain link picker (was missing)
--
-- Guarded so a preview branch replaying on an empty DB is a no-op.

do $mig$
declare
  u uuid;
  nb uuid;
begin
  if to_regclass('public.notes') is null then
    raise notice 'notes three-tier skipped: notes table absent (preview replay?)';
    return;
  end if;

  -- 1. widen the type check
  alter table public.notes drop constraint if exists notes_type_check;
  alter table public.notes add constraint notes_type_check
    check (type = any (array['notebook'::text, 'folder'::text, 'file'::text]));

  -- 2. drop the old parent rules before the backfill (root folders violate
  --    the new shape until they're reparented)
  alter table public.notes drop constraint if exists notes_parent_rules;

  -- 3. reparent each user's root folders under a "My Notes" Cabinet
  for u in select distinct created_by from public.notes
           where type = 'folder' and parent_id is null
  loop
    insert into public.notes (type, name, parent_id, created_by)
    values ('notebook', 'My Notes', null, u)
    returning id into nb;
    update public.notes
      set parent_id = nb
      where type = 'folder' and parent_id is null and created_by = u and id <> nb;
  end loop;

  alter table public.notes add constraint notes_parent_rules
    check (
      (type = 'notebook' and parent_id is null)
      or (type in ('folder', 'file') and parent_id is not null)
    );

  -- 4. Cabinet → Domain link column
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notes'
      and column_name = 'linked_domain_id'
  ) then
    if to_regclass('public.domains') is not null then
      alter table public.notes add column linked_domain_id uuid
        references public.domains(id) on delete set null;
    else
      alter table public.notes add column linked_domain_id uuid;
    end if;
  end if;
end
$mig$;

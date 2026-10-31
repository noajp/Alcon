-- Whoever can archive an Object can also delete it: an owner or admin of the
-- Object, or of the Domain it lives in (alcon_internal.user_manages_object,
-- the rule objects_archive_guard applies). Objects made by seeds or agents
-- often have no object_members row, so the Object-only rule refused every
-- delete of them without a word.
do $$
begin
  if to_regclass('public.objects') is null
     or to_regprocedure('alcon_internal.user_manages_object(uuid)') is null
     or to_regprocedure('public.user_has_object_role(uuid, text[])') is null then
    raise notice 'objects delete policy skipped: objects or its role helpers not present'; return;
  end if;
  execute 'drop policy if exists "objects delete owner admin" on public.objects';
  execute $p$
    create policy "objects delete owner admin" on public.objects for delete to authenticated
    using (public.user_has_object_role(id, array['owner', 'admin']) or alcon_internal.user_manages_object(id))
  $p$;
end $$;

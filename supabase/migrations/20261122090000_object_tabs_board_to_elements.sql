-- The Board tab is gone: the Execution Chain is the one board of
-- Elements. A tab a person added as Board showed the Object's Elements
-- in Status columns; those Elements now read through the Elements list,
-- so rewrite the stored rows to say so. The tab keeps its title and its
-- place in the strip. ObjectDetailView also falls back to the Elements
-- list for any row this has not reached, so nothing renders blank in
-- the meantime.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.object_tabs') is not null then
    execute 'update public.object_tabs set tab_type = ''elements'' where tab_type = ''board''';
  end if;
end $$;

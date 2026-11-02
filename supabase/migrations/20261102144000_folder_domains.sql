-- A folder belongs to a Domain, as an Object does: Files and Table list a
-- Domain's folders under the Domain, the way Execution lists its Objects.
-- space_attachments says which Domain each file sits in (through its
-- Element's or Object's Domain, or its folder's), so Files can list a
-- Domain's files; files with no Domain (an Initiative's, a CRM record's)
-- are in the Space's list only.
do $$
begin
  if to_regclass('public.folders') is null or to_regclass('public.domains') is null then
    raise notice 'folder domains skipped: folders or domains not present'; return;
  end if;
  execute 'alter table public.folders add column if not exists domain_id uuid references public.domains(id) on delete cascade';
  execute 'create index if not exists folders_domain_idx on public.folders(domain_id, app, position) where domain_id is not null';
end $$;

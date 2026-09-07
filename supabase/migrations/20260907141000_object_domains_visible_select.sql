-- A readable Object/Domain pair is a visible relationship for members and
-- guests as well as owners. Writes continue to use the existing owner policy.
do $migration$
begin
  if to_regclass('public.object_domains') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null then
    raise notice 'Object Domain visibility skipped: base schema absent';
    return;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'object_domains' and policyname = 'object_domains_visible_select') then
    execute $policy$
      create policy object_domains_visible_select on public.object_domains
        for select to authenticated
        using (public.user_can_see_domain(domain_id) and public.user_can_see_object(object_id))
    $policy$;
  end if;
end
$migration$;

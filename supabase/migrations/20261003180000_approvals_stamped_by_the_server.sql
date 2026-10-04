-- An approval decision's time and name are the server's (ELE_AI-103).
--
-- element_approvals is already read-if-you-see-the-Element and
-- insert-as-yourself. A browser could still date its own row in the future —
-- it then sat at the top of the approval history (ordered by decided_at) — or
-- write any approver_name beside its own approver_id. From a browser
-- (auth.uid() set), decided_at is now() and approver_name is the person's
-- profile name, falling back to what the app sent. Service-role writes keep
-- their values.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.element_approvals') is null
     or to_regclass('public.profiles') is null then
    raise notice 'approvals_stamped_by_the_server skipped: base schema not present';
    return;
  end if;

  execute $f$
    create or replace function public.element_approvals_stamp()
    returns trigger language plpgsql security definer set search_path = '' as $b$
    begin
      if auth.uid() is null then
        return new;
      end if;
      new.decided_at := now();
      new.approver_name := coalesce(
        (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = auth.uid()),
        nullif(btrim(new.approver_name), ''));
      return new;
    end
    $b$
  $f$;
  execute 'revoke all on function public.element_approvals_stamp() from public, anon, authenticated';
  execute 'drop trigger if exists element_approvals_stamp on public.element_approvals';
  execute 'create trigger element_approvals_stamp before insert on public.element_approvals
    for each row execute function public.element_approvals_stamp()';
end $$;

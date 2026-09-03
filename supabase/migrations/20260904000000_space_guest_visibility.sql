-- el_QLT-026: Administration > Member's cross-Domain Guest list undercounts.
-- domain_members' SELECT policy is `user_id = auth.uid() OR
-- user_is_domain_member(domain_id)` — no branch for "this Domain is
-- workspace-privacy and I'm a Space member", unlike `domains` itself (whose
-- SELECT policy DOES have that branch). So a Space owner who hasn't
-- personally joined a colleague's workspace-privacy Domain sees that
-- Domain's row (via `domains`) but zero of its domain_members rows —
-- MemberSettings.tsx's Guest query silently returns nothing for it.
--
-- This RPC gives Space members exactly the cross-Domain Guest visibility the
-- boundary model already promises for workspace-privacy Domains, without
-- loosening domain_members' own RLS (which stays correct for every other
-- caller/path): workspace Domains are visible Space-wide regardless of
-- personal Domain membership; private Domains stay gated on the caller
-- actually being a member of that specific Domain, same as today.
--
-- SECURITY DEFINER is required to read domain_members rows the caller's own
-- RLS would otherwise hide for workspace Domains; the boundary check is
-- reimplemented inside the function body rather than bypassed, and the
-- function returns only what a Space member is entitled to see under that
-- same model — nothing it wouldn't already piece together by joining a
-- Domain and looking. STABLE + no side effects; GRANT is to `authenticated`
-- only (a Space member — the query itself has no rows for anyone who isn't).
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and every table/function it depends on lives outside the
-- migrations folder (base schema).

do $migration$
begin
  if to_regclass('public.domains') is null
     or to_regclass('public.domain_members') is null
     or to_regclass('public.activity_space_members') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.user_is_domain_member(uuid)') is null then
    raise notice 'get_space_guest_domain_members skipped: base schema not present';
    return;
  end if;

  execute $sql$
    create or replace function public.get_space_guest_domain_members(p_space_id uuid)
    returns table (user_id uuid, domain_id uuid, domain_name text, domain_role text)
    language sql
    stable
    security definer
    set search_path = public, pg_catalog
    as $fn$
      select dm.user_id, d.id as domain_id, d.name as domain_name, dm.role as domain_role
      from domains d
      join domain_members dm on dm.domain_id = d.id
      where d.activity_space_id = p_space_id
        and is_activity_space_member(p_space_id)
        and (d.privacy = 'workspace' or user_is_domain_member(d.id))
        and not exists (
          select 1 from activity_space_members asm
          where asm.activity_space_id = p_space_id and asm.user_id = dm.user_id
        );
    $fn$;
  $sql$;

  execute 'grant execute on function public.get_space_guest_domain_members(uuid) to authenticated';
end
$migration$;

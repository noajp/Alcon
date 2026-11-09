-- Back-half program B10 (capability attenuation for chained runs):
-- the chain scope's shelf. One column on agent_runs — chain_scope
-- jsonb, null for a run that carries no scope (every run today: a
-- person's start is an unscoped root by definition). The scope
-- itself is minted server-side at a run's birth from settled
-- records (the parent's row, the child's definition, the Space's
-- connection rows and tested manifests — _shared/chainScope.ts)
-- and written only at insert, only by the service role; the
-- trigger below makes a written scope immutable, which is what
-- lets the decision path skip any re-check: argument rules can
-- change while a run rests, a scope cannot change at all.
--
-- chain_scope() exposes a presented JWT's alcon_chain claim beside
-- is_delegated_request() (a chain JWT carries alcon_via, so
-- is_delegated_request() is true for it: chain driving is delegated
-- driving, refused token management and the rest of that refusal
-- set — intended). No policy reads chain_scope() in v1; the helper
-- is for visibility and future surfaces. The claim is carriage
-- only — the row is the truth the gate enforces from.
--
-- No new table, no agent_actions change (a chain denial leaves no
-- action row, exactly as a manifest denial does today; its evidence
-- is the run's trace step and the verdict's chain block).
-- Deploy order: the code reads a missing column as "no scope", so
-- functions may deploy before or after this migration; applying it
-- (with run-agent / automations redeployed) closes the production
-- catch-up entry for B10.
do $$
begin
  if to_regclass('public.agent_runs') is null
     or to_regprocedure('public.is_delegated_request()') is null then
    raise notice 'chain scope skipped: agent_runs or is_delegated_request not present';
    return;
  end if;

  execute 'alter table public.agent_runs add column if not exists chain_scope jsonb';

  execute $fn$
    create or replace function public.guard_agent_run_chain_scope()
    returns trigger
    language plpgsql
    set search_path = public
    as $b$
    begin
      if tg_op = 'INSERT' then
        -- Written at birth, by the engine alone: a person's start
        -- inserts through their own session and is a root (null) by
        -- definition, so any scoped insert that is not the service
        -- role is refused outright.
        if new.chain_scope is not null
           and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
          raise exception 'a run''s chain scope is minted by the engine alone'
            using errcode = '42501';
        end if;
      elsif new.chain_scope is distinct from old.chain_scope then
        -- Never afterwards, by anyone: the scope a run was born
        -- with is the scope it is judged by, whole run long.
        raise exception 'a run''s chain scope never changes once minted'
          using errcode = '42501';
      end if;
      return new;
    end;
    $b$
  $fn$;
  execute 'drop trigger if exists guard_agent_run_chain_scope on public.agent_runs';
  execute 'create trigger guard_agent_run_chain_scope before insert or update on public.agent_runs for each row execute function public.guard_agent_run_chain_scope()';

  execute $fn$
    create or replace function public.chain_scope()
    returns jsonb
    language sql
    stable
    set search_path = ''
    as $b$
      select auth.jwt() -> 'alcon_chain'
    $b$
  $fn$;
  execute 'revoke all on function public.chain_scope() from public';
  execute 'grant execute on function public.chain_scope() to anon, authenticated, service_role';
end $$;

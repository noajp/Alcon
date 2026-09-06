-- Element lease: who is working on this, on which branch, and until when.
--
-- Until now "▶ 着手 — branch: …" was a prose convention. Nothing enforced it,
-- so an Element could sit in_progress with no way to tell who held it
-- (el_OPS-013 was nearly written off as an orphan) and a premise could vanish
-- with nobody noticing (el_UXQ-009 sank for days). Three columns make the
-- claim structural:
--
--   claimed_by        text  — the holder token. Deliberately NOT a foreign
--                             key: a holder is a session, not a durable
--                             entity, and that non-durability is the whole
--                             point of a lease.
--   claim_expires_at  timestamptz — when the claim lapses if the holder
--                             stops reporting.
--   branch            text  — the resource that actually conflicts between
--                             sessions. Two agents can look at one Element;
--                             two agents cannot push to one branch.
--
-- The holder token must be SESSION-UNIQUE. It is not the comment author's
-- display name: every AI session writes comments as author_name = 'Claude',
-- so matching on that would collapse every session into one holder — any
-- session could take over any other's Element, and a stranger's comment
-- would keep a dead session's lease alive. Instead a comment carries its own
-- `holder` column, set by the writer that holds the lease, and only a
-- comment whose holder matches claimed_by renews it. A human comment (holder
-- null) never renews, whatever the author is called.
--
-- claim_element() is the only way in — enforced, not asserted. Supabase's
-- default table-level grants give authenticated INSERT/UPDATE on every
-- column, and a column-level REVOKE cannot subtract from a table-level
-- grant, so the lease columns and the comment's holder stamp are guarded by
-- BEFORE triggers instead: only postgres (the SECURITY DEFINER RPCs and the
-- heartbeat trigger run as their owner) and service_role (the ops scripts)
-- may write them. An app user's ordinary update that leaves them unchanged
-- passes; one that touches them is rejected.
--
-- A partial unique index can't express
-- "unique unless expired" (now() isn't immutable), so the exclusion lives in
-- the RPC's single UPDATE: under READ COMMITTED a concurrent loser re-checks
-- the WHERE after the winner's row lock releases, sees a fresh claim, and
-- gets 0 rows → false. Same contract as ops/singleLease.mjs's claimLease():
-- true means run, false means leave quietly.
--
-- Both RPCs are SECURITY DEFINER (the caller may lack UPDATE on the row), so
-- they authorize themselves: a signed-in caller must be able to see the
-- Element; service_role (auth.uid() null) is the ops scripts and passes.
-- anon is revoked explicitly — Supabase's default ACL grants anon EXECUTE on
-- every new function, and `revoke from public` does not touch that grant.
--
-- The trigger is the heart of it. Any comment by the holder extends the
-- lease — reporting and keeping the claim are one act. Silence cannot hold
-- an Element. stall-check already treats the progress comment as the
-- heartbeat, so no new clock is introduced: element_lease_ttl() is the one
-- place the interval lives.
--
-- Protocol wiring (the friction skill's ▶ 着手 calling claim_element, and
-- ops writers stamping `holder` on their comments) lands separately — this
-- file is the substrate. Guarded for preview/shadow-DB replay.
do $migration$
begin
  if to_regclass('public.elements') is null
     or to_regclass('public.element_comments') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null then
    raise notice 'element_lease migration skipped: dependencies not present';
    return;
  end if;

  execute $ddl$
    alter table public.elements
      add column if not exists claimed_by       text,
      add column if not exists claim_expires_at timestamptz,
      add column if not exists branch           text
  $ddl$;

  -- The comment's own statement of who wrote it, as a lease holder. Distinct
  -- from author_name (a display string shared by every AI session).
  execute $ddl$
    alter table public.element_comments
      add column if not exists holder text
  $ddl$;

  -- One clock. The RPC and the trigger both read it, so the lease can never
  -- be granted for one length and renewed for another.
  execute $fn$
    create or replace function public.element_lease_ttl()
    returns interval
    language sql
    immutable
    as $body$ select interval '40 minutes' $body$
  $fn$;

  execute $fn$
    create or replace function public.claim_element(
      p_element_id uuid,
      p_holder     text,
      p_branch     text default null
    )
    returns boolean
    language plpgsql
    security definer
    set search_path to 'public'
    as $body$
    declare
      v_rows int;
    begin
      if p_holder is null or btrim(p_holder) = '' then
        raise exception 'claim_element: holder is required';
      end if;
      if auth.uid() is not null and not user_can_see_element(p_element_id) then
        raise exception 'Not authorized to claim this Element';
      end if;

      update elements
         set claimed_by       = p_holder,
             -- A takeover must not inherit the previous holder's branch: the
             -- ledger would then say the new holder is writing to a branch
             -- they never touched. Only a renewal by the same holder keeps
             -- the existing branch when none is passed.
             branch           = case when claimed_by is distinct from p_holder
                                     then p_branch
                                     else coalesce(p_branch, branch) end,
             claim_expires_at = now() + element_lease_ttl()
       where id = p_element_id
         and (
               claimed_by is null
            or claim_expires_at is null
            or claim_expires_at < now()
            or claimed_by = p_holder
         );

      get diagnostics v_rows = row_count;
      return v_rows = 1;
    end
    $body$
  $fn$;

  execute $fn$
    create or replace function public.release_element(p_element_id uuid, p_holder text)
    returns boolean
    language plpgsql
    security definer
    set search_path to 'public'
    as $body$
    declare
      v_rows int;
    begin
      if auth.uid() is not null and not user_can_see_element(p_element_id) then
        raise exception 'Not authorized to release this Element';
      end if;
      update elements
         set claimed_by = null, claim_expires_at = null, branch = null
       where id = p_element_id and claimed_by = p_holder;
      get diagnostics v_rows = row_count;
      return v_rows = 1;
    end
    $body$
  $fn$;

  -- Reporting is renewing. Only a comment stamped with the holder's own
  -- token counts; author_name is never consulted (see header).
  execute $fn$
    create or replace function public.extend_element_lease_on_comment()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $body$
    begin
      if new.holder is null then
        return new;
      end if;
      update elements
         set claim_expires_at = now() + element_lease_ttl()
       where id = new.element_id
         and claimed_by = new.holder;
      return new;
    end
    $body$
  $fn$;

  execute $trg$
    drop trigger if exists trg_element_lease_extend on public.element_comments
  $trg$;
  execute $trg$
    create trigger trg_element_lease_extend
      after insert on public.element_comments
      for each row execute function public.extend_element_lease_on_comment()
  $trg$;

  -- The door is the only door: direct writes to the lease columns and to
  -- the holder stamp are rejected for everyone but the RPC owner and the
  -- service role. Checked on current_user, which inside a SECURITY DEFINER
  -- body is the function owner — so the RPCs and the heartbeat trigger pass
  -- while the same user's direct PostgREST write does not.
  execute $fn$
    create or replace function public.guard_element_lease_columns()
    returns trigger
    language plpgsql
    as $body$
    begin
      if current_user in ('postgres', 'service_role', 'supabase_admin') then
        return new;
      end if;
      if tg_op = 'INSERT' then
        if new.claimed_by is not null or new.claim_expires_at is not null or new.branch is not null then
          raise exception 'lease columns are written only through claim_element() / release_element()';
        end if;
      elsif (new.claimed_by, new.claim_expires_at, new.branch)
            is distinct from (old.claimed_by, old.claim_expires_at, old.branch) then
        raise exception 'lease columns are written only through claim_element() / release_element()';
      end if;
      return new;
    end
    $body$
  $fn$;
  execute $trg$ drop trigger if exists trg_guard_element_lease on public.elements $trg$;
  execute $trg$
    create trigger trg_guard_element_lease
      before insert or update on public.elements
      for each row execute function public.guard_element_lease_columns()
  $trg$;

  execute $fn$
    create or replace function public.guard_comment_holder()
    returns trigger
    language plpgsql
    as $body$
    begin
      if current_user in ('postgres', 'service_role', 'supabase_admin') then
        return new;
      end if;
      if tg_op = 'INSERT' then
        if new.holder is not null then
          raise exception 'holder is stamped only by the lease-holding session (service role)';
        end if;
      elsif new.holder is distinct from old.holder then
        raise exception 'holder is stamped only by the lease-holding session (service role)';
      end if;
      return new;
    end
    $body$
  $fn$;
  execute $trg$ drop trigger if exists trg_guard_comment_holder on public.element_comments $trg$;
  execute $trg$
    create trigger trg_guard_comment_holder
      before insert or update on public.element_comments
      for each row execute function public.guard_comment_holder()
  $trg$;

  -- Callable by the app (authenticated, gated inside) and by ops scripts
  -- (service_role). anon is revoked by name — the default ACL grants it.
  execute $grant$ revoke all on function public.claim_element(uuid, text, text) from public, anon $grant$;
  execute $grant$ grant execute on function public.claim_element(uuid, text, text) to authenticated, service_role $grant$;
  execute $grant$ revoke all on function public.release_element(uuid, text) from public, anon $grant$;
  execute $grant$ grant execute on function public.release_element(uuid, text) to authenticated, service_role $grant$;
end
$migration$;

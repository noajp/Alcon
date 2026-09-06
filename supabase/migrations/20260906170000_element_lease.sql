-- Element lease: who is working on this, on which branch, and until when.
--
-- Until now "▶ 着手 — branch: …" was a prose convention. Nothing enforced it,
-- so an Element could sit in_progress with no way to tell who held it
-- (el_OPS-013 was nearly written off as an orphan) and a premise could vanish
-- with nobody noticing (el_UXQ-009 sank for days). Three columns make the
-- claim structural:
--
--   claimed_by        text  — the holder's name. Deliberately NOT a foreign
--                             key: a holder is a session, not a durable
--                             entity, and that non-durability is the whole
--                             point of a lease.
--   claim_expires_at  timestamptz — when the claim lapses if the holder
--                             stops reporting.
--   branch            text  — the resource that actually conflicts between
--                             sessions. Two agents can look at one Element;
--                             two agents cannot push to one branch.
--
-- claim_element() is the only way in. A partial unique index can't express
-- "unique unless expired" (now() isn't immutable), so the exclusion lives in
-- the RPC's single UPDATE: under READ COMMITTED a concurrent loser re-checks
-- the WHERE after the winner's row lock releases, sees a fresh claim, and
-- gets 0 rows → false. Same contract as ops/singleLease.mjs's claimLease():
-- true means run, false means leave quietly.
--
-- The trigger is the heart of it. Any comment by the holder extends the
-- lease — reporting and keeping the claim are one act. Silence cannot hold
-- an Element. stall-check already treats the progress comment as the
-- heartbeat, so no new clock is introduced: element_lease_ttl() is the one
-- place the interval lives.
--
-- Guarded for preview/shadow-DB replay; the base schema lives outside this
-- folder.
do $migration$
begin
  if to_regclass('public.elements') is null or to_regclass('public.element_comments') is null then
    raise notice 'element_lease migration skipped: elements/element_comments not present';
    return;
  end if;

  execute $ddl$
    alter table public.elements
      add column if not exists claimed_by       text,
      add column if not exists claim_expires_at timestamptz,
      add column if not exists branch           text
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

      update elements
         set claimed_by       = p_holder,
             branch           = coalesce(p_branch, branch),
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
      update elements
         set claimed_by = null, claim_expires_at = null, branch = null
       where id = p_element_id and claimed_by = p_holder;
      get diagnostics v_rows = row_count;
      return v_rows = 1;
    end
    $body$
  $fn$;

  -- Reporting is renewing. Only the holder's own comments count; anyone
  -- else talking about the Element must not keep a dead holder's claim alive.
  execute $fn$
    create or replace function public.extend_element_lease_on_comment()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $body$
    begin
      update elements
         set claim_expires_at = now() + element_lease_ttl()
       where id = new.element_id
         and claimed_by is not null
         and claimed_by = new.author_name;
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

  -- Callable by the app (authenticated) and by ops scripts (service_role).
  execute $grant$ revoke all on function public.claim_element(uuid, text, text) from public $grant$;
  execute $grant$ grant execute on function public.claim_element(uuid, text, text) to authenticated, service_role $grant$;
  execute $grant$ revoke all on function public.release_element(uuid, text) from public $grant$;
  execute $grant$ grant execute on function public.release_element(uuid, text) to authenticated, service_role $grant$;
end
$migration$;

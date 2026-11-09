-- Failure definitions (back-half program B13), second migration: the
-- exception catalog.
--
--   catalog_items.kind    learns 'exception'. An exception item's body
--                         is its payload: { match, response } — the
--                         failures it speaks to, and what happens
--                         then (failurePolicy.ts' parseExceptionEntry
--                         is the contract's reader; an unreadable
--                         payload is treated as no entry at all).
--   the standard pack     five seeds, all version 1: an unknown
--                         destination, a partial outage, rate
--                         limiting, an expired credential, a stale
--                         source. (Duplicate submission is NOT an
--                         entry — it is the retry floor, "a landed
--                         write is never blindly re-run"; a deadline
--                         conflict has no classifiable signal yet.)
--   space_exception_installs
--                         a Space's installs of exception items.
--                         Exception items have no definitions copy to
--                         live in, so the install record is its own
--                         table: the catalog version recorded at
--                         install, an enabled flag that stops an
--                         entry without deleting it. Member-select
--                         RLS; no write policies — writes are the
--                         owner RPCs' act alone.
--   the owner RPCs        install / uninstall / set-enabled, each
--                         checking is_activity_space_owner inside and
--                         refusing with 42501 (the B6 posture): an
--                         exception entry can declare compensate:
--                         auto or a retry count for a whole Space, a
--                         blast radius wider than one definition's
--                         copy, so its governance matches.
--   agent_runs.failure_detail
--                         the settle's own record (B13 §6.5): the
--                         class a run's failure settled under, the
--                         compensation policy and escalation with the
--                         layer that spoke for each. The audit's
--                         drill-down reads it — this migration must
--                         reach production BEFORE the web that
--                         selects it (the chain_scope coupling).
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
declare
  v_kind_check text;
  v_kind_def text;
begin
  if to_regclass('public.catalog_items') is null
     or to_regclass('public.activity_spaces') is null
     or to_regclass('public.agent_runs') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'exception catalog skipped: catalog_items, activity_spaces, agent_runs or space role functions not present';
    return;
  end if;

  -- ── 1. The kind check learns 'exception' ────────────────────────
  select conname, pg_get_constraintdef(oid) into v_kind_check, v_kind_def
    from pg_constraint
   where conrelid = 'public.catalog_items'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind%'
   limit 1;
  if v_kind_check is not null and v_kind_def not like '%exception%' then
    execute format('alter table public.catalog_items drop constraint %I', v_kind_check);
    execute 'alter table public.catalog_items add constraint catalog_items_kind_check check (kind in (''definition'', ''pack'', ''exception''))';
  end if;

  -- ── 2. The standard pack (all version 1) ────────────────────────
  execute $seed$
    insert into public.catalog_items (id, kind, name, description, body, payload, sort, version) values
    ('exc.unknown-destination', 'exception', '宛先が見つからない', '呼び出し先が見つからなかった失敗。存在しない宛先は再試行しない。', null, '{"match": {"error_class": "not_found", "destination_pattern": null, "tool": null}, "response": [{"class": "not_found", "retry": 0, "compensate": "ask", "escalate": "inbox", "give_up_after": null}]}', 210, 1),
    ('exc.partial-outage', 'exception', '相手先の一部障害', '相手先が一時的に応答しない失敗。間を置いて再試行する。', null, '{"match": {"error_class": "unavailable", "destination_pattern": null, "tool": null}, "response": [{"class": "unavailable", "retry": 2, "compensate": "ask", "escalate": "inbox", "give_up_after": null}]}', 220, 1),
    ('exc.rate-limited', 'exception', 'レート制限', '相手先のレート制限にかかった失敗。再試行で吸収する。', null, '{"match": {"error_class": "rate_limited", "destination_pattern": null, "tool": null}, "response": [{"class": "rate_limited", "retry": 3, "compensate": "ask", "escalate": "inbox", "give_up_after": null}]}', 230, 1),
    ('exc.credential-expired', 'exception', '認証情報の失効', '認証が通らなかった失敗。直すためのカードとは別に、失敗の報告としてオーナーに知らせる。', null, '{"match": {"error_class": "auth_failed", "destination_pattern": null, "tool": null}, "response": [{"class": "auth_failed", "retry": 0, "compensate": "ask", "escalate": "owner", "give_up_after": null}]}', 240, 1),
    ('exc.stale-source', 'exception', '出典が古い', '完了報告の出典が、鮮度の上限より古かった失敗。', null, '{"match": {"error_class": "stale_claims", "destination_pattern": null, "tool": null}, "response": [{"class": "stale_claims", "retry": 0, "compensate": "ask", "escalate": "inbox", "give_up_after": null}]}', 250, 1)
    on conflict (id) do update set kind = excluded.kind, name = excluded.name, description = excluded.description,
      body = excluded.body, payload = excluded.payload, sort = excluded.sort, updated_at = now()
  $seed$;

  -- ── 3. The installs table ───────────────────────────────────────
  execute $ddl$
    create table if not exists public.space_exception_installs (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      catalog_item_id text not null references public.catalog_items(id) on delete cascade,
      version integer not null,
      enabled boolean not null default true,
      installed_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (activity_space_id, catalog_item_id)
    )
  $ddl$;
  execute 'create index if not exists space_exception_installs_space_idx on public.space_exception_installs (activity_space_id, enabled)';
  execute 'alter table public.space_exception_installs enable row level security';
  execute 'revoke all on public.space_exception_installs from anon, authenticated';
  execute 'grant select on public.space_exception_installs to authenticated';
  execute 'drop policy if exists space_exception_installs_select on public.space_exception_installs';
  execute $p$
    create policy space_exception_installs_select on public.space_exception_installs
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $p$;
  -- No insert / update / delete policy: installs change only through
  -- the owner-checked RPCs below.

  -- ── 4. The owner RPCs ───────────────────────────────────────────
  execute $ddl$
    create or replace function public.install_catalog_exception(p_space_id uuid, p_item_id text)
    returns uuid
    language plpgsql
    security definer
    set search_path = public
    as $f$
    declare
      v_item public.catalog_items%rowtype;
      v_id uuid;
      v_now timestamptz := now();
    begin
      -- Installing is the owner's act, checked here and not in any
      -- UI (the D1 posture): an installed entry speaks for the whole
      -- Space's failures.
      if not public.is_activity_space_owner(p_space_id) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      select * into v_item from public.catalog_items where id = p_item_id;
      if not found or v_item.kind <> 'exception' then
        raise exception 'exception catalog item not found' using errcode = 'P0002';
      end if;
      -- A re-install is the update act: it takes the catalog's
      -- current version and re-enables the entry. Nothing updates
      -- itself underneath a Space.
      insert into public.space_exception_installs (activity_space_id, catalog_item_id, version, enabled, installed_by)
      values (p_space_id, p_item_id, v_item.version, true, (select auth.uid()))
      on conflict (activity_space_id, catalog_item_id)
      do update set version = excluded.version, enabled = true,
        installed_by = excluded.installed_by, updated_at = v_now
      returning id into v_id;
      return v_id;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.install_catalog_exception(uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.install_catalog_exception(uuid, text) to authenticated';

  execute $ddl$
    create or replace function public.uninstall_catalog_exception(p_space_id uuid, p_item_id text)
    returns boolean
    language plpgsql
    security definer
    set search_path = public
    as $f$
    begin
      if not public.is_activity_space_owner(p_space_id) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      delete from public.space_exception_installs
       where activity_space_id = p_space_id and catalog_item_id = p_item_id;
      return found;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.uninstall_catalog_exception(uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.uninstall_catalog_exception(uuid, text) to authenticated';

  execute $ddl$
    create or replace function public.set_catalog_exception_enabled(p_space_id uuid, p_item_id text, p_enabled boolean)
    returns boolean
    language plpgsql
    security definer
    set search_path = public
    as $f$
    begin
      if not public.is_activity_space_owner(p_space_id) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      update public.space_exception_installs
         set enabled = p_enabled, updated_at = now()
       where activity_space_id = p_space_id and catalog_item_id = p_item_id;
      return found;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.set_catalog_exception_enabled(uuid, text, boolean) from public, anon, authenticated';
  execute 'grant execute on function public.set_catalog_exception_enabled(uuid, text, boolean) to authenticated';

  -- ── 5. The settle's record column ───────────────────────────────
  execute 'alter table public.agent_runs add column if not exists failure_detail jsonb';
end $$;

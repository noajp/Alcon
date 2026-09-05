-- RenamePrefixDialog.tsx's own comment named the gap it left open: the
-- manual-rename check-then-write is plain client-side SELECT-then-UPDATE,
-- outside the pg_advisory_xact_lock the auto-generate path already uses
-- (20260903000000_object_prefix_advisory_lock.sql) — that lock only guards
-- set_object_display_id's `prefix is null` branch, which a manual rename
-- (always a non-null prefix) never takes. Two structural holes followed:
--
-- 1. Two people renaming different Objects to the same prefix within the
--    same round trip can both pass the client's collision check before
--    either write lands — the lock closes exactly this, the same way it
--    already closes the equivalent race for auto-generated prefixes.
-- 2. The client's collision SELECT is RLS-scoped to the caller — an Object
--    in a private Domain the caller isn't a member of doesn't appear in the
--    query, so a real collision against it goes undetected.
--
-- A SECURITY DEFINER RPC that does the check and the write inside one
-- transaction, under the same advisory lock key the trigger uses, closes
-- both at once: the lock serializes concurrent renames the same way it
-- already serializes concurrent auto-generates, and running the collision
-- check as the function owner (not the caller) sees every Object in the
-- Space regardless of the caller's own visibility.
--
-- Authorization is NOT "can see" — user_is_object_member(id) is the exact
-- predicate the objects table's own "objects update members" RLS policy
-- already uses for a plain UPDATE, so this RPC grants no more than a direct
-- UPDATE already would; it only makes the collision check see what RLS
-- would otherwise hide from it. The actual prefix write goes through a
-- plain `update objects set prefix = ...`, which fires the *same*
-- trg_object_display_id trigger a client UPDATE would (it's `BEFORE INSERT
-- OR UPDATE OF name, prefix`) — the trigger's own `if new.prefix is null`
-- branch is skipped for a non-null rename exactly as it is today, and it
-- still recomputes display_id unconditionally, so this RPC never touches
-- display_id itself.
--
-- The format check below mirrors RenamePrefixDialog.tsx's own
-- PREFIX_PATTERN/maxLength — required here too, not just in the dialog,
-- because this RPC is callable directly (any object_member can reach it via
-- supabase.rpc(), not only through the dialog's own input validation).
-- Without it, an empty/null p_new_prefix would slip past the collision
-- check (NULL-unsafe equality never matches) and land back in
-- trg_object_display_id's auto-generate branch instead of being rejected —
-- a confusing silent fallback for a call that looks like it should have
-- errored — and this is exactly the "unreadable id" class of bug
-- (el_QLT-012's "医療安全" → "P1—こ") this whole feature exists to let an
-- admin fix, now reachable on demand instead of only through mangled
-- auto-generation.
do $migration$
begin
  if to_regclass('public.objects') is null
     or to_regclass('public.domains') is null
     or to_regprocedure('public.user_is_object_member(uuid)') is null then
    raise notice 'object_prefix_rename_rpc migration skipped: dependencies not present';
    return;
  end if;

  execute $fn$
    create or replace function public.rename_object_prefix(p_object_id uuid, p_new_prefix text)
    returns objects
    language plpgsql
    security definer
    set search_path = public, pg_catalog
    as $body$
    declare
      v_space uuid;
      v_normalized text := upper(p_new_prefix);
      v_result objects;
    begin
      if not user_is_object_member(p_object_id) then
        raise exception 'Not authorized to rename this Object''s prefix'
          using errcode = '42501';
      end if;

      if p_new_prefix is null or p_new_prefix = '' or length(p_new_prefix) > 12
         or v_normalized !~ '^[A-Z0-9]+$' then
        raise exception 'Prefix can only contain letters and numbers, 1-12 characters'
          using errcode = '22023';
      end if;

      select d.activity_space_id into v_space
      from objects o
      left join domains d on d.id = o.domain_id
      where o.id = p_object_id;

      if not found then
        raise exception 'Object not found' using errcode = 'P0002';
      end if;

      -- Same lock key as set_object_display_id's auto-generate branch, so a
      -- manual rename and a concurrent auto-generate in the same Space
      -- serialize against each other too, not just against other manual
      -- renames.
      if v_space is not null then
        perform pg_advisory_xact_lock(hashtext('object_prefix'), hashtext(v_space::text));
      end if;

      if exists (
        select 1
        from objects o
        left join domains d on d.id = o.domain_id
        where o.id <> p_object_id
          and o.prefix is not null
          and o.prefix <> ''
          and upper(o.prefix) = v_normalized
          and d.activity_space_id is not distinct from v_space
      ) then
        raise exception 'Prefix "%" is already used by another Object in this Space', v_normalized
          using errcode = '23505';
      end if;

      update objects set prefix = v_normalized where id = p_object_id
      returning * into v_result;

      return v_result;
    end
    $body$;
  $fn$;

  execute 'revoke all on function public.rename_object_prefix(uuid, text) from public';
  execute 'grant execute on function public.rename_object_prefix(uuid, text) to authenticated';
end
$migration$;

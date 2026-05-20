-- The TS types, StatusPicker, and createElement all already treat
-- 'backlog' and 'cancelled' as valid Element statuses, but the elements
-- status CHECK constraint never included them — so picking Backlog or
-- Cancelled (e.g. from StatusPicker, or → Element 化 on a note bullet)
-- threw elements_status_check. Widen the allowlist to match the code.
-- Purely additive: every existing row's status is in the old subset, so
-- all rows still satisfy the new constraint.
--
-- Wrapped in the same "skip on preview replay" guard as the surrounding
-- migrations: if public.elements hasn't been created yet (fresh preview
-- branch replaying the migrations folder), this becomes a no-op.

do $$
begin
  if to_regclass('public.elements') is null then
    raise notice 'elements_status_check widen skipped: elements not present';
    return;
  end if;

  execute 'alter table public.elements drop constraint if exists elements_status_check';
  execute $check$
    alter table public.elements
      add constraint elements_status_check
      check (status = any (array['backlog','todo','in_progress','review','done','blocked','cancelled']))
  $check$;
end
$$;

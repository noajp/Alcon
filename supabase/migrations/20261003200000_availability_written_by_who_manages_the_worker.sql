-- A Worker's absences and capacity spans are written by whoever manages the
-- Worker (ELE_AI-101): the person themselves, a member of an unlinked Worker's
-- Space, anyone who can see an Object Worker's Object, or an owner of the
-- person's Space or Domain — alcon_internal.user_can_manage_worker, the same
-- rule as editing the Worker (ADR 0028). Reading stays as it is: a span is
-- visible with its Worker.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.worker_availability') is null
     or to_regprocedure('alcon_internal.user_can_manage_worker(uuid)') is null then
    raise notice 'availability_written_by_who_manages_the_worker skipped: base schema not present';
    return;
  end if;

  execute 'drop policy if exists worker_availability_insert on public.worker_availability';
  execute 'drop policy if exists worker_availability_update on public.worker_availability';
  execute 'drop policy if exists worker_availability_delete on public.worker_availability';
  execute 'create policy worker_availability_insert on public.worker_availability for insert to authenticated
    with check (alcon_internal.user_can_manage_worker(worker_id))';
  execute 'create policy worker_availability_update on public.worker_availability for update to authenticated
    using (alcon_internal.user_can_manage_worker(worker_id))
    with check (alcon_internal.user_can_manage_worker(worker_id))';
  execute 'create policy worker_availability_delete on public.worker_availability for delete to authenticated
    using (alcon_internal.user_can_manage_worker(worker_id))';
end $$;

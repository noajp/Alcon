-- element_activity — what happened to an Element, when, by whom.
--
-- The Activity rail in ElementDetailView was localStorage: it showed only
-- the changes this browser made, and its own header said a real table would
-- replace it. This is that table, in the shape the rail already renders
-- (kind / detail / author / created_at), so the swap is a read path, not a
-- redesign.
--
-- Status changes are recorded by a trigger, not by the UI: a status set by an
-- agent through the service role, by SQL, or by another client is a status
-- change all the same, and el_TRJ-005 exists because none of those left a
-- trace. author is the signed-in user's display name, else the lease holder
-- (an agent writing as the service role has no auth.uid()), else System.
-- actor_id defaults to auth.uid() so a client insert carries who did it
-- without being trusted to say so.
--
-- Append-only for users: SELECT follows the Element's visibility; INSERT is
-- any signed-in user who can see the Element; no UPDATE / DELETE policy.
-- Guarded for preview/shadow-DB replay.
do $m$
begin
  if to_regclass('public.elements') is null or to_regprocedure('public.user_can_see_element(uuid)') is null then
    raise notice 'element_activity migration skipped: dependencies not present'; return;
  end if;

  execute $ddl$
    create table if not exists public.element_activity (
      id          uuid primary key default gen_random_uuid(),
      element_id  uuid not null references public.elements(id) on delete cascade,
      kind        text not null,
      detail      text not null,
      author      text not null default 'System',
      actor_id    uuid default auth.uid(),
      created_at  timestamptz not null default now()
    )
  $ddl$;
  execute $ddl$ create index if not exists element_activity_element_created_idx on public.element_activity (element_id, created_at desc) $ddl$;
  execute $ddl$ alter table public.element_activity enable row level security $ddl$;
  execute $ddl$ drop policy if exists element_activity_select on public.element_activity $ddl$;
  execute $ddl$
    create policy element_activity_select on public.element_activity
      for select using (public.user_can_see_element(element_id))
  $ddl$;
  execute $ddl$ drop policy if exists element_activity_insert on public.element_activity $ddl$;
  execute $ddl$
    create policy element_activity_insert on public.element_activity
      for insert with check (auth.uid() is not null and public.user_can_see_element(element_id))
  $ddl$;

  execute $fn$
    create or replace function public.record_element_status_change()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $body$
    declare
      v_actor uuid := auth.uid();
      v_author text;
    begin
      select p.display_name into v_author from profiles p where p.id = v_actor;
      insert into element_activity (element_id, kind, detail, author, actor_id)
      values (
        new.id,
        'status',
        coalesce(old.status, '—') || ' → ' || coalesce(new.status, '—'),
        coalesce(nullif(v_author, ''), new.claimed_by, 'System'),
        v_actor
      );
      return new;
    end
    $body$
  $fn$;
  execute $trg$ drop trigger if exists trg_element_status_activity on public.elements $trg$;
  execute $trg$
    create trigger trg_element_status_activity
      after update of status on public.elements
      for each row when (new.status is distinct from old.status)
      execute function public.record_element_status_change()
  $trg$;
end
$m$;

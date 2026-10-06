-- People: what a Worker knows, and the finished work that shows it (ADR 0038).
--
-- A skill is a name and a self- or manager-declared level (1 Learning,
-- 2 Capable, 3 Proficient, 4 Expert). Its evidence is the Worker's own done
-- Elements — the board already holds the proof, so a claim points at it
-- instead of restating it. The same rows describe a human and an AI agent.
--
-- Reading follows the Worker: a skill is as visible as the Worker it belongs
-- to (a policy subquery runs under the caller's own RLS, as with
-- worker_availability). An evidence row is visible only to someone who can
-- also see its Element, so a skill never discloses work outside the reader's
-- boundary. Writing follows alcon_internal.user_can_manage_worker, the same
-- rule as editing the Worker (ADR 0028).
--
-- Evaluations are deliberately not here: they need a reporting line and a
-- read boundary of their own, which Space / Domain membership cannot express.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $migration$
begin
  if to_regclass('public.workers') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.element_assignees') is null
     or to_regprocedure('alcon_internal.user_can_manage_worker(uuid)') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null then
    raise notice 'worker_skills skipped: base schema not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.worker_skills (
      id         uuid primary key default gen_random_uuid(),
      worker_id  uuid not null references public.workers(id) on delete cascade,
      name       text not null check (char_length(btrim(name)) between 1 and 60),
      level      smallint not null default 2 check (level between 1 and 4),
      created_by uuid default auth.uid() references auth.users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $ddl$;
  -- "React" and "react " are one skill for the same Worker.
  execute 'create unique index if not exists worker_skills_worker_name_key
           on public.worker_skills (worker_id, lower(btrim(name)))';

  execute $ddl$
    create table if not exists public.worker_skill_evidence (
      skill_id   uuid not null references public.worker_skills(id) on delete cascade,
      element_id uuid not null references public.elements(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (skill_id, element_id)
    )
  $ddl$;
  execute 'create index if not exists worker_skill_evidence_element_idx
           on public.worker_skill_evidence (element_id)';

  execute 'alter table public.worker_skills enable row level security';
  execute 'alter table public.worker_skill_evidence enable row level security';

  execute 'drop policy if exists worker_skills_select on public.worker_skills';
  execute 'drop policy if exists worker_skills_insert on public.worker_skills';
  execute 'drop policy if exists worker_skills_update on public.worker_skills';
  execute 'drop policy if exists worker_skills_delete on public.worker_skills';
  execute 'create policy worker_skills_select on public.worker_skills for select to authenticated
    using (exists (select 1 from public.workers w where w.id = worker_id))';
  execute 'create policy worker_skills_insert on public.worker_skills for insert to authenticated
    with check (alcon_internal.user_can_manage_worker(worker_id))';
  execute 'create policy worker_skills_update on public.worker_skills for update to authenticated
    using (alcon_internal.user_can_manage_worker(worker_id))
    with check (alcon_internal.user_can_manage_worker(worker_id))';
  execute 'create policy worker_skills_delete on public.worker_skills for delete to authenticated
    using (alcon_internal.user_can_manage_worker(worker_id))';

  execute 'drop policy if exists worker_skill_evidence_select on public.worker_skill_evidence';
  execute 'drop policy if exists worker_skill_evidence_insert on public.worker_skill_evidence';
  execute 'drop policy if exists worker_skill_evidence_delete on public.worker_skill_evidence';
  execute 'create policy worker_skill_evidence_select on public.worker_skill_evidence for select to authenticated
    using (public.user_can_see_element(element_id)
           and exists (select 1 from public.worker_skills s where s.id = skill_id))';
  -- Evidence is the Worker's own finished work: the Element is done and
  -- assigned to the skill's Worker.
  execute 'create policy worker_skill_evidence_insert on public.worker_skill_evidence for insert to authenticated
    with check (
      public.user_can_see_element(element_id)
      and exists (
        select 1
          from public.worker_skills s
          join public.element_assignees ea on ea.worker_id = s.worker_id
          join public.elements e on e.id = ea.element_id
         where s.id = skill_id
           and ea.element_id = worker_skill_evidence.element_id
           and e.status = ''done''
           and alcon_internal.user_can_manage_worker(s.worker_id)))';
  execute 'create policy worker_skill_evidence_delete on public.worker_skill_evidence for delete to authenticated
    using (exists (select 1 from public.worker_skills s
                    where s.id = skill_id and alcon_internal.user_can_manage_worker(s.worker_id)))';
end $migration$;

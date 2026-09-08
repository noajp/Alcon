-- Domain is a continuing arena. Approaches relate intent to work without nesting Objects.
do $migration$
begin
  if to_regclass('public.domains') is null or to_regclass('public.intents') is null
    or to_regclass('public.object_domains') is null then
    raise notice 'Domain approaches skipped: base schema absent'; return;
  end if;

  create table public.domain_approaches (
    id uuid primary key default gen_random_uuid(),
    domain_id uuid not null references public.domains(id) on delete cascade,
    strategy_id uuid not null references public.strategies(id) on delete restrict,
    measure_id uuid references public.intents(id) on delete set null,
    title text not null check (length(btrim(title)) between 1 and 300),
    expected_change text not null check (length(btrim(expected_change)) > 0),
    hypothesis text not null check (length(btrim(hypothesis)) > 0),
    assumptions text not null default '',
    review_trigger text not null default '',
    review_date date,
    revision integer not null default 1,
    plan_revision integer not null default 1,
    created_by uuid not null default auth.uid() references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index on public.domain_approaches(domain_id);
  create index on public.domain_approaches(strategy_id);
  create index on public.domain_approaches(measure_id);
  create index on public.domain_approaches(created_by);

  create table public.approach_conditions (
    id uuid primary key default gen_random_uuid(),
    approach_id uuid not null references public.domain_approaches(id) on delete cascade,
    title text not null check (length(btrim(title)) between 1 and 300),
    kind text not null check (kind in ('outcome','readiness','learning')),
    required boolean not null default true,
    success_criteria text not null check (length(btrim(success_criteria)) > 0),
    review_date date,
    created_at timestamptz not null default now(),
    unique(id, approach_id)
  );
  create index on public.approach_conditions(approach_id);
  create table public.approach_contributions (
    id uuid primary key default gen_random_uuid(),
    approach_id uuid not null references public.domain_approaches(id) on delete cascade,
    condition_id uuid not null,
    object_id uuid not null references public.objects(id) on delete cascade,
    role text not null check (role in ('primary','alternative','supporting')),
    rationale text not null check (length(btrim(rationale)) > 0),
    sequence_note text not null default '',
    unique(condition_id, object_id),
    foreign key(condition_id, approach_id) references public.approach_conditions(id, approach_id) on delete cascade
  );
  create index on public.approach_contributions(approach_id);
  create index on public.approach_contributions(object_id);
  create table public.approach_assessments (
    id uuid primary key default gen_random_uuid(),
    approach_id uuid not null references public.domain_approaches(id) on delete cascade,
    condition_id uuid not null,
    plan_revision integer not null,
    result text not null check (result in ('met','not_met','unverified','refuted')),
    observation text not null check (length(btrim(observation)) > 0),
    evidence_source text not null check (length(btrim(evidence_source)) > 0),
    observed_on date not null,
    reasoning text not null check (length(btrim(reasoning)) > 0),
    author_id uuid not null default auth.uid() references auth.users(id),
    created_at timestamptz not null default now(),
    foreign key(condition_id, approach_id) references public.approach_conditions(id, approach_id) on delete cascade
  );
  create index on public.approach_assessments(approach_id);
  create index on public.approach_assessments(condition_id, created_at desc);
  create index on public.approach_assessments(author_id);
  create table public.approach_reviews (
    id uuid primary key default gen_random_uuid(),
    approach_id uuid not null references public.domain_approaches(id) on delete cascade,
    expected_revision integer not null,
    action text not null check (action in ('continue','change','stop')),
    reasoning text not null check (length(btrim(reasoning)) > 0),
    changes text not null default '',
    next_review_date date,
    snapshot jsonb not null default '{}'::jsonb,
    author_id uuid not null default auth.uid() references auth.users(id),
    created_at timestamptz not null default now(),
    check (action <> 'change' or length(btrim(changes)) > 0)
  );
  create index on public.approach_reviews(approach_id, created_at desc);
  create index on public.approach_reviews(author_id);

  execute $fn$
    create function public.can_edit_domain_approaches(p_domain_id uuid) returns boolean
    language sql stable security invoker set search_path = public as $body$
      select auth.uid() is not null and (
        exists (select 1 from public.domains where id=p_domain_id and user_id=auth.uid())
        or public.user_has_domain_role(p_domain_id, array['owner','admin'])
      )
    $body$
  $fn$;
  revoke all on function public.can_edit_domain_approaches(uuid) from public, anon;
  grant execute on function public.can_edit_domain_approaches(uuid) to authenticated;

  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.domain_approaches;
  end if;
  alter table public.domain_approaches enable row level security;
  create policy approaches_read on public.domain_approaches for select to authenticated
    using (public.user_can_see_domain(domain_id) and public.user_can_see_strategy(strategy_id));
  create policy approaches_insert on public.domain_approaches for insert to authenticated
    with check (public.can_edit_domain_approaches(domain_id) and public.user_can_see_strategy(strategy_id) and created_by=auth.uid());
  create policy approaches_update on public.domain_approaches for update to authenticated
    using (public.can_edit_domain_approaches(domain_id) and public.user_can_see_strategy(strategy_id))
    with check (public.can_edit_domain_approaches(domain_id) and public.user_can_see_strategy(strategy_id));

  -- All descendants inherit BOTH Domain and Initiative visibility. Object links also
  -- require visibility of the Object; invisible names/roles are never fetched.
  declare t text;
  begin
    foreach t in array array['approach_conditions','approach_contributions','approach_assessments','approach_reviews'] loop
      execute format('alter table public.%I enable row level security', t);
      execute format('create policy child_read on public.%I for select to authenticated using (exists (select 1 from public.domain_approaches a where a.id=approach_id)%s)', t,
        case when t='approach_contributions' then ' and public.user_can_see_object(object_id)' else '' end);
      execute format('create policy child_insert on public.%I for insert to authenticated with check (exists (select 1 from public.domain_approaches a where a.id=approach_id and public.can_edit_domain_approaches(a.domain_id)))', t);
      if t in ('approach_conditions','approach_contributions') then
        execute format('create policy child_update on public.%I for update to authenticated using (exists (select 1 from public.domain_approaches a where a.id=approach_id and public.can_edit_domain_approaches(a.domain_id))) with check (exists (select 1 from public.domain_approaches a where a.id=approach_id and public.can_edit_domain_approaches(a.domain_id)))', t);
      end if;
      if exists (select 1 from pg_publication where pubname='supabase_realtime') then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
      execute format('revoke all on public.%I from anon, authenticated', t);
      execute format('grant select, insert on public.%I to authenticated', t);
    end loop;
  end;
  revoke all on public.domain_approaches from anon, authenticated;
  grant select, insert on public.domain_approaches to authenticated;
  grant update(title, expected_change, hypothesis, assumptions, review_trigger, review_date, measure_id, revision, plan_revision) on public.domain_approaches to authenticated;
  grant update(title, kind, required, success_criteria, review_date) on public.approach_conditions to authenticated;
  grant update(role, rationale, sequence_note) on public.approach_contributions to authenticated;

  execute $fn$
    create function public.stamp_domain_approach() returns trigger language plpgsql
    security invoker set search_path = public as $body$
    begin
      if new.measure_id is not null and not exists (
        select 1 from public.intents where id=new.measure_id and strategy_id=new.strategy_id and kind='measure'
      ) then raise exception 'Choose a success condition from this Initiative'; end if;
      if tg_op='INSERT' then
        new.created_by := auth.uid(); new.created_at := clock_timestamp();
        new.revision := 1; new.plan_revision := 1;
      else
        new.revision := old.revision+1;
        new.plan_revision := old.plan_revision + case when
          row(new.title,new.expected_change,new.hypothesis,new.assumptions,new.measure_id)
          is distinct from row(old.title,old.expected_change,old.hypothesis,old.assumptions,old.measure_id)
          or new.plan_revision <> old.plan_revision then 1 else 0 end;
      end if;
      new.updated_at := clock_timestamp(); return new;
    end $body$
  $fn$;
  create trigger stamp_domain_approach before insert or update on public.domain_approaches
    for each row execute function public.stamp_domain_approach();

  execute $fn$
    create function public.stamp_approach_child() returns trigger language plpgsql
    security invoker set search_path = public as $body$
    declare a public.domain_approaches; plan_changed boolean;
    begin
      select * into a from public.domain_approaches where id=new.approach_id for update;
      if not found or not public.can_edit_domain_approaches(a.domain_id) then
        raise exception 'You cannot edit this Domain approach';
      end if;
      if tg_table_name='approach_contributions' then
        if not public.user_can_see_object(new.object_id) or not exists (
          select 1 from public.objects o where o.id=new.object_id and (o.domain_id=a.domain_id or exists (
            select 1 from public.object_domains od where od.object_id=o.id and od.domain_id=a.domain_id
          ))
        ) then raise exception 'Choose a visible Object in this Domain'; end if;
      elsif tg_table_name='approach_assessments' then
        if new.plan_revision <> a.plan_revision then raise exception 'The approach changed. Refresh before assessing.'; end if;
        new.author_id := auth.uid(); new.created_at := clock_timestamp();
      elsif tg_table_name='approach_reviews' then
        if new.expected_revision <> a.revision then raise exception 'The approach changed. Refresh before reviewing.'; end if;
        new.author_id := auth.uid(); new.created_at := clock_timestamp();
        new.snapshot := jsonb_build_object('approach',to_jsonb(a),
          'conditions',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.approach_conditions c where c.approach_id=a.id),
          'contributions',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.approach_contributions c where c.approach_id=a.id),
          'assessments',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from (select distinct on (condition_id) * from public.approach_assessments where approach_id=a.id order by condition_id,created_at desc,id desc) c));
      end if;
      plan_changed := tg_table_name in ('approach_conditions','approach_contributions');
      update public.domain_approaches set revision=revision+1,
        plan_revision=plan_revision+case when plan_changed then 1 else 0 end where id=a.id;
      return new;
    end $body$
  $fn$;
  declare t text;
  begin
    foreach t in array array['approach_conditions','approach_contributions','approach_assessments','approach_reviews'] loop
      execute format('create trigger stamp_child before insert or update on public.%I for each row execute function public.stamp_approach_child()', t);
    end loop;
  end;
  execute $fn$
    create function public.edit_approach_plan_item(p_kind text, p_id uuid, p_revision integer, p_patch jsonb)
    returns void language plpgsql security invoker set search_path = public as $body$
    declare aid uuid; current_revision integer;
    begin
      if p_kind='condition' then select approach_id into aid from public.approach_conditions where id=p_id;
      elsif p_kind='contribution' then select approach_id into aid from public.approach_contributions where id=p_id;
      else raise exception 'Unknown approach item'; end if;
      select revision into current_revision from public.domain_approaches where id=aid for update;
      if current_revision is null or current_revision <> p_revision then
        raise exception 'The approach changed. Refresh before saving.';
      end if;
      if p_kind='condition' then
        update public.approach_conditions set title=p_patch->>'title', kind=p_patch->>'kind',
          required=(p_patch->>'required')::boolean, success_criteria=p_patch->>'success_criteria',
          review_date=nullif(p_patch->>'review_date','')::date where id=p_id;
      else
        update public.approach_contributions set role=p_patch->>'role', rationale=p_patch->>'rationale',
          sequence_note=p_patch->>'sequence_note' where id=p_id;
      end if;
      if not found then raise exception 'This approach item is unavailable'; end if;
    end $body$
  $fn$;
  revoke all on function public.edit_approach_plan_item(text,uuid,integer,jsonb) from public, anon;
  grant execute on function public.edit_approach_plan_item(text,uuid,integer,jsonb) to authenticated;
  revoke all on function public.stamp_domain_approach() from public, anon, authenticated;
  revoke all on function public.stamp_approach_child() from public, anon, authenticated;
end
$migration$;

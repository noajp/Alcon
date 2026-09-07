-- Existing core tables were created outside the migration history. Empty
-- preview databases skip this feature until that baseline is provisioned.
do $migration$
begin
  if exists (select 1 from unnest(array[
    'elements','objects','domains','element_objects','object_domains','workers',
    'element_assignees','subelements','element_edges','element_comments','profiles',
    'notifications','activity_space_members'
  ]) t(name) where to_regclass('public.' || name) is null) then
    raise notice 'Coordination core skipped: core schema is not provisioned';
    return;
  end if;
  execute $ddl$

-- Membership checks deliberately bypass the owner-only object_domains policy,
-- but never bypass the canonical Object/Element visibility helpers.
create or replace function public.coordination_element_in_space(p_element_id uuid, p_space_id uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null and p_space_id is not null
    and public.user_can_see_element(p_element_id)
    and exists (
      select 1 from public.elements e join public.objects o
        on o.id = e.object_id or exists (
          select 1 from public.element_objects eo where eo.element_id=e.id and eo.object_id=o.id)
      where e.id=p_element_id
        and public.user_can_see_object(o.id)
        and (exists (select 1 from public.domains d where d.id=o.domain_id and d.activity_space_id=p_space_id)
          or exists (select 1 from public.object_domains od join public.domains d on d.id=od.domain_id
            where od.object_id=o.id and d.activity_space_id=p_space_id))
    );
$fn$;
revoke all on function public.coordination_element_in_space(uuid,uuid) from public, anon;
grant execute on function public.coordination_element_in_space(uuid,uuid) to authenticated;

create or replace function public.get_now_work(p_space_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_objects uuid[];
  v_elements uuid[];
  v_result jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='Sign in to read Space work.'; end if;
  if p_space_id is null then raise exception using errcode='22023', message='Select a Space.'; end if;
  -- Explicit Object membership also admits a guest; Space membership is not
  -- required when canonical visibility grants a narrower view of this Space.
  select coalesce(array_agg(o.id), '{}') into v_objects from public.objects o
  where public.user_can_see_object(o.id)
    and (exists (select 1 from public.domains d where d.id=o.domain_id and d.activity_space_id=p_space_id)
      or exists (select 1 from public.object_domains od join public.domains d on d.id=od.domain_id
        where od.object_id=o.id and d.activity_space_id=p_space_id));
  select coalesce(array_agg(e.id), '{}') into v_elements from public.elements e
  where public.user_can_see_element(e.id)
    and (e.object_id=any(v_objects) or exists (
      select 1 from public.element_objects eo where eo.element_id=e.id and eo.object_id=any(v_objects)));
  if cardinality(v_objects)>10000 or cardinality(v_elements)>20000 then
    raise exception using errcode='54000', message='This Space exceeds the Now read limit. Open an Object to continue.';
  end if;
  with scoped_workers as materialized (
    select w.* from public.workers w where exists (
      select 1 from public.element_assignees ea where ea.worker_id=w.id and ea.element_id=any(v_elements))
      or w.object_id=any(v_objects)
      or (exists(select 1 from public.activity_space_members mine where mine.activity_space_id=p_space_id and mine.user_id=auth.uid())
        and exists(select 1 from public.activity_space_members member where member.activity_space_id=p_space_id and member.user_id=w.user_id))
  ), worker_rows as materialized (
    select w.id, to_jsonb(w) || jsonb_build_object('ai_config',null,'email',null,
      'object_id',case when w.object_id=any(v_objects) then w.object_id else null end) as item
    from scoped_workers w
  ), element_rows as (
    select e.id, to_jsonb(e) || jsonb_build_object(
      'object_id',case when e.object_id=any(v_objects) then e.object_id else null end,
      'objectIds', h.ids, 'isMultiHomed',jsonb_array_length(h.ids)>1,
      'objects', h.objects,
      'assignees', coalesce((select jsonb_agg(to_jsonb(ea) || jsonb_build_object('worker',w.item) order by ea.id)
        from public.element_assignees ea left join worker_rows w on w.id=ea.worker_id where ea.element_id=e.id), '[]'::jsonb),
      'subelements',coalesce((select jsonb_agg(to_jsonb(s) order by s.order_index,s.id)
        from public.subelements s where s.element_id=e.id), '[]'::jsonb)
    ) as item
    from public.elements e cross join lateral (
      select coalesce(jsonb_agg(o.id order by o.id),'[]'::jsonb) as ids,
        coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.id),'[]'::jsonb) as objects
      from public.objects o where o.id=any(v_objects) and (o.id=e.object_id or exists (
        select 1 from public.element_objects eo where eo.element_id=e.id and eo.object_id=o.id))
    ) h where e.id=any(v_elements)
  ), edge_rows as (
    select ed.id, case when ed.from_element=any(v_elements) and ed.to_element=any(v_elements)
      then to_jsonb(ed) else jsonb_build_object('id',ed.id,'from_element',ed.from_element,
        'to_element',ed.to_element,'edge_type','depends_on','attributes','{}'::jsonb,'created_at',null,'created_by',null) end as item
    from public.element_edges ed where ed.edge_type='depends_on'
      and (ed.from_element=any(v_elements) or ed.to_element=any(v_elements))
  )
  select jsonb_build_object(
    'elements',coalesce((select jsonb_agg(item order by id) from element_rows),'[]'::jsonb),
    'workers',coalesce((select jsonb_agg(item order by id) from worker_rows),'[]'::jsonb),
    'objects',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'domain_id',
      case when exists(select 1 from public.domains d where d.id=o.domain_id and d.activity_space_id=p_space_id
        and public.user_can_see_domain(d.id)) then o.domain_id else null end) order by o.id)
      from public.objects o where o.id=any(v_objects)),'[]'::jsonb),
    'edges',coalesce((select jsonb_agg(item order by id) from edge_rows),'[]'::jsonb),
    'readAt',statement_timestamp()
  ) into v_result;
  -- A single scalar JSON result cannot be silently truncated by PostgREST's
  -- row cap. Never turn resource protection into partial, falsely-ready data.
  if octet_length(v_result::text)>25000000 then
    raise exception using errcode='54000', message='This Space exceeds the Now response limit. Open an Object to continue.';
  end if;
  return v_result;
end;
$fn$;
revoke all on function public.get_now_work(uuid) from public, anon;
grant execute on function public.get_now_work(uuid) to authenticated;

-- Immutable operation receipts survive deletion/editing of the shared comment.
-- The transaction ID is server-owned and cannot be supplied by REST clients.
create table if not exists public.element_check_ins (
  request_id uuid primary key,
  element_id uuid not null references public.elements(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  expected_updated_at timestamptz,
  patch jsonb not null,
  note text not null,
  comment_id uuid not null,
  comment_content text not null,
  result_updated_at timestamptz not null,
  transaction_id xid8 not null default pg_current_xact_id(),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.element_check_ins enable row level security;
create policy "Read own visible check-in receipts" on public.element_check_ins for select to authenticated
  using (author_id=auth.uid() and public.user_can_see_element(element_id));
create policy "Insert own visible check-in receipts" on public.element_check_ins for insert to authenticated
  with check (author_id=auth.uid() and public.user_can_see_element(element_id));
revoke all on public.element_check_ins from public, anon, authenticated;
grant select on public.element_check_ins to authenticated;
grant insert (request_id,element_id,author_id,expected_updated_at,patch,note,comment_id,comment_content,result_updated_at)
  on public.element_check_ins to authenticated;

-- Preserve the existing notification recipients for every other update path.
-- No exposed RPC accepts arbitrary set_config/SQL. Even a forged GUC must match
-- a receipt created in this same transaction, by this actor, for this Element.
create or replace function public.notify_element_status()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_actor uuid := auth.uid();
  v_suffix text := case new.status when 'done' then ' is done' else ' is blocked' end;
begin
  if exists (select 1 from public.element_check_ins ci
    where ci.request_id::text=current_setting('alcon.check_in_request',true)
      and ci.transaction_id=pg_current_xact_id() and ci.element_id=new.id
      and ci.author_id=v_actor and ci.result_updated_at=new.updated_at) then
    return new;
  end if;
  insert into public.notifications (recipient_id, actor_id, kind, element_id, title, body)
  select distinct r.user_id, v_actor, 'status_change', new.id,
    new.title || v_suffix, coalesce(old.status, '—') || ' → ' || new.status
  from (
    select w.user_id from public.element_assignees ea join public.workers w on w.id=ea.worker_id
      where ea.element_id=new.id and w.user_id is not null
    union select new.owner_id where new.owner_id is not null
    union select d.user_id from public.objects o join public.domains d on d.id=o.domain_id
      where o.id=new.object_id and d.user_id is not null
  ) r where r.user_id is not null and (v_actor is null or r.user_id<>v_actor);
  return new;
end;
$fn$;

create or replace function public.check_in_element(
  p_element_id uuid, p_expected_updated_at timestamptz, p_request_id uuid,
  p_patch jsonb default '{}'::jsonb, p_note text default ''
) returns jsonb language plpgsql security invoker set search_path = '' as $fn$
declare
  v_element public.elements%rowtype;
  v_receipt public.element_check_ins%rowtype;
  v_comment public.element_comments%rowtype;
  v_actor uuid := auth.uid();
  v_at timestamptz;
  v_note text := btrim(coalesce(p_note,''));
  v_patch jsonb := coalesce(p_patch,'{}'::jsonb);
  v_status text;
  v_next text;
  v_content text := '';
  v_author text;
  v_previous_guc text := current_setting('alcon.check_in_request',true);
  v_changed boolean := false;
begin
  if v_actor is null or not public.user_can_see_element(p_element_id) then
    raise exception using errcode='42501', message='This Element is unavailable or you cannot update it.';
  end if;
  if p_request_id is null or jsonb_typeof(v_patch)<>'object'
    or exists(select 1 from jsonb_object_keys(v_patch) k where k not in ('status','next'))
    or length(v_note)>4000 then
    raise exception using errcode='22023', message='Invalid check-in. Use a note up to 4000 characters.';
  end if;
  if v_patch ? 'status' and (jsonb_typeof(v_patch->'status')<>'string'
    or v_patch->>'status' not in ('backlog','todo','in_progress','review','done','blocked','cancelled')) then
    raise exception using errcode='22023', message='Choose a valid status.';
  end if;
  if v_patch ? 'next' and (jsonb_typeof(v_patch->'next') not in ('string','null') or length(v_patch->>'next')>2000) then
    raise exception using errcode='22023', message='Use a next action up to 2000 characters.';
  end if;
  select * into v_element from public.elements where id=p_element_id for update;
  if not found then raise exception using errcode='42501', message='This Element is unavailable or you cannot update it.'; end if;
  select * into v_receipt from public.element_check_ins where request_id=p_request_id;
  if found then
    if v_receipt.element_id<>p_element_id or v_receipt.author_id<>v_actor
      or v_receipt.patch<>v_patch or v_receipt.note<>v_note
      or v_receipt.expected_updated_at is distinct from p_expected_updated_at then
      raise exception using errcode='22023', message='This request ID belongs to a different check-in.';
    end if;
    select * into v_comment from public.element_comments where id=v_receipt.comment_id;
    if not found or v_comment.element_id<>p_element_id or v_comment.author_id is distinct from v_actor
      or v_comment.author_kind<>'human' or v_comment.content<>v_receipt.comment_content
      or v_comment.created_at<>v_receipt.result_updated_at or v_comment.updated_at<>v_receipt.result_updated_at then
      raise exception using errcode='P0002', message='This check-in was saved, but its shared comment was edited or removed. Refresh before making another check-in.';
    end if;
    return jsonb_build_object('element',to_jsonb(v_element),'comment',to_jsonb(v_comment),'replayed',true);
  end if;
  if v_element.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='40001', message='This Element changed while you were writing. Refresh and review the latest status before saving.';
  end if;
  v_status := case when v_patch ? 'status' then v_patch->>'status' else v_element.status end;
  v_next := nullif(btrim(v_patch->>'next'),'');
  if v_patch ? 'status' and v_status='done' and v_element.is_approval and v_element.approval_state is distinct from 'approved' then
    raise exception using errcode='22023', message='This Element needs approval before it can be marked done.';
  end if;
  if v_patch ? 'status' and v_status is distinct from v_element.status then
    v_changed := true;
    v_content := 'Status: ' || coalesce(replace(v_element.status,'_',' '),'unspecified') || ' → ' || replace(v_status,'_',' ');
  end if;
  if v_patch ? 'next' and v_next is distinct from nullif(btrim(v_element.direction->>'next'),'') then
    v_changed := true;
    v_content := concat_ws(E'\n',nullif(v_content,''),'Next: ' || coalesce(v_next,'cleared'));
  end if;
  if not v_changed and v_note='' then raise exception using errcode='22023', message='Change the status or next action, or add a note.'; end if;
  v_content := concat_ws(E'\n\n',nullif(v_content,''),nullif(v_note,''));
  v_at := clock_timestamp();
  select nullif(btrim(display_name),'') into v_author from public.profiles where id=v_actor;
  insert into public.element_check_ins
    (request_id,element_id,author_id,expected_updated_at,patch,note,comment_id,comment_content,result_updated_at)
    values (p_request_id,p_element_id,v_actor,p_expected_updated_at,v_patch,v_note,p_request_id,v_content,v_at);
  perform set_config('alcon.check_in_request',p_request_id::text,true);
  update public.elements set
    status=v_status,
    progress=case when v_patch ? 'status' and v_status='done' then 100
      when v_patch ? 'status' and (v_status in ('backlog','todo') or (v_element.status='done' and v_status<>'done')) then null else progress end,
    direction=case when v_patch ? 'next' then
      case when v_next is null then coalesce(direction,'{}'::jsonb)-'next'
        else jsonb_set(coalesce(direction,'{}'::jsonb),'{next}',to_jsonb(v_next)) end
      else direction end,
    updated_at=v_at
    where id=p_element_id returning * into v_element;
  if not found then raise exception using errcode='42501', message='This Element is unavailable or you cannot update it.'; end if;
  perform set_config('alcon.check_in_request',coalesce(v_previous_guc,''),true);
  insert into public.element_comments(id,element_id,author_id,author_kind,author_name,content,created_at,updated_at)
    values (p_request_id,p_element_id,v_actor,'human',coalesce(v_author,'Member'),v_content,v_at,v_at)
    returning * into v_comment;
  return jsonb_build_object('element',to_jsonb(v_element),'comment',to_jsonb(v_comment),'replayed',false);
end;
$fn$;
revoke all on function public.check_in_element(uuid,timestamptz,uuid,jsonb,text) from public, anon;
grant execute on function public.check_in_element(uuid,timestamptz,uuid,jsonb,text) to authenticated;

create or replace function public.set_element_dependency(
  p_space_id uuid, p_upstream_id uuid, p_downstream_id uuid, p_remove boolean default false
) returns jsonb language plpgsql security invoker set search_path = '' as $fn$
declare v_edge public.element_edges%rowtype;
begin
  if auth.uid() is null or not public.coordination_element_in_space(p_upstream_id,p_space_id)
    or not public.coordination_element_in_space(p_downstream_id,p_space_id) then
    raise exception using errcode='42501', message='Both Elements must be visible in the current Space.';
  end if;
  if p_upstream_id=p_downstream_id then raise exception using errcode='22023', message='An Element cannot depend on itself.'; end if;
  -- One lock covers multi-homed Elements, whose shared cycle can span Spaces.
  -- Space-only locks could admit A→B and B→A through different homes at once.
  perform pg_advisory_xact_lock(hashtextextended('alcon.element_dependencies',0));
  if p_remove then
    delete from public.element_edges where from_element=p_upstream_id and to_element=p_downstream_id and edge_type='depends_on';
    return null;
  end if;
  select * into v_edge from public.element_edges where from_element=p_upstream_id and to_element=p_downstream_id and edge_type='depends_on';
  if found then return to_jsonb(v_edge); end if;
  if exists (
    with recursive reachable(id) as (
      select p_downstream_id
      union
      select e.to_element from public.element_edges e join reachable r on e.from_element=r.id where e.edge_type='depends_on'
    ) select 1 from reachable where id=p_upstream_id
  ) then raise exception using errcode='22023', message='This dependency would create a cycle.'; end if;
  insert into public.element_edges(from_element,to_element,edge_type,created_by)
    values(p_upstream_id,p_downstream_id,'depends_on',auth.uid()) returning * into v_edge;
  return to_jsonb(v_edge);
end;
$fn$;
revoke all on function public.set_element_dependency(uuid,uuid,uuid,boolean) from public, anon;
grant execute on function public.set_element_dependency(uuid,uuid,uuid,boolean) to authenticated;

$ddl$;
end;
$migration$;

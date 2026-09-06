-- LOCAL ONLY: psql -d alcon_coordination_test -f this-file
-- Minimal baseline preserving the production columns/policies used by these RPCs.
do $$ begin
  if current_database()<>'alcon_coordination_test' then raise exception 'This fixture requires the disposable alcon_coordination_test database'; end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,public to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table public.activity_space_members(activity_space_id uuid,user_id uuid);
create table public.domains(id uuid primary key, activity_space_id uuid, user_id uuid, visible boolean default true);
create table public.objects(id uuid primary key, name text, domain_id uuid, visible boolean default true);
create table public.object_domains(object_id uuid, domain_id uuid);
create table public.elements(id uuid primary key, title text, object_id uuid, owner_id uuid, status text, progress int, direction jsonb, updated_at timestamptz, is_approval boolean not null default false, approval_state text);
create table public.element_objects(element_id uuid,object_id uuid);
create table public.workers(id uuid primary key, name text, user_id uuid, object_id uuid, ai_config jsonb, email text);
create table public.element_assignees(id uuid primary key,element_id uuid,worker_id uuid,role text);
create table public.subelements(id uuid primary key,element_id uuid,title text,order_index int);
create table public.element_edges(id uuid primary key default gen_random_uuid(), from_element uuid references elements, to_element uuid references elements, edge_type text, attributes jsonb default '{}',created_by uuid,created_at timestamptz default now(),unique(from_element,to_element,edge_type));
create table public.profiles(id uuid primary key,display_name text);
create table public.element_comments(id uuid primary key default gen_random_uuid(),element_id uuid not null references elements on delete cascade,parent_id uuid,author_id uuid,author_kind text not null default 'human',author_name text,content text not null,mentions uuid[] default '{}',is_pinned boolean default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,actor_id uuid,kind text,element_id uuid,comment_id uuid,title text,body text);
create function public.user_can_see_domain(x uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from domains where id=x and visible) $$;
create function public.user_can_see_object(x uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from objects where id=x and visible) $$;
create function public.user_can_see_element(x uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from elements e where id=x and (owner_id=auth.uid() or user_can_see_object(object_id) or exists(select 1 from element_objects eo where eo.element_id=e.id and user_can_see_object(eo.object_id)) or object_id is null and owner_id is null)) $$;
alter table public.elements enable row level security;
create policy visible_elements on public.elements to authenticated using (public.user_can_see_element(id)) with check (owner_id=auth.uid() or public.user_can_see_object(object_id) or object_id is null and owner_id is null);
alter table public.objects enable row level security;
create policy visible_objects on public.objects to authenticated using (public.user_can_see_object(id));
alter table public.object_domains enable row level security;
create policy owner_only on public.object_domains to authenticated using (exists(select 1 from domains d where d.id=domain_id and d.user_id=auth.uid()));
grant select,insert,update,delete on all tables in schema public to authenticated;
-- Original status trigger body, saved from production before the migration.
create function public.notify_element_status() returns trigger language plpgsql security definer set search_path to 'public' as $$
    declare
      v_actor  uuid := auth.uid();
      v_suffix text := case new.status when 'done' then ' is done'
                                       else ' is blocked' end;
    begin
      insert into notifications
        (recipient_id, actor_id, kind, element_id, title, body)
      select distinct r.user_id, v_actor, 'status_change',
             new.id,
             new.title || v_suffix,
             coalesce(old.status, '—') || ' → ' || new.status
      from (
        select w.user_id
        from element_assignees ea
        join workers w on w.id = ea.worker_id
        where ea.element_id = new.id and w.user_id is not null
        union
        select new.owner_id where new.owner_id is not null
        union
        select d.user_id
        from objects o
        join domains d on d.id = o.domain_id
        where o.id = new.object_id and d.user_id is not null
      ) r
      where r.user_id is not null
        and (v_actor is null or r.user_id <> v_actor);
      return new;
    end
$$;
create trigger notify_status after update of status on elements for each row when (new.status is distinct from old.status and new.status in ('done','blocked')) execute function notify_element_status();
create function notify_comment() returns trigger language plpgsql security definer set search_path=public as $$ begin
  insert into notifications(recipient_id,actor_id,kind,element_id,comment_id) select w.user_id,new.author_id,'comment',new.element_id,new.id from workers w join element_assignees ea on ea.worker_id=w.id where ea.element_id=new.element_id and w.user_id<>new.author_id;
  return new;
end $$;
create trigger notify_comment after insert on element_comments for each row execute function notify_comment();

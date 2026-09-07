-- LOCAL ONLY. Run with psql -v ON_ERROR_STOP=1 in a fresh, disposable
-- alcon_import_test database. The fixture reproduces the production RLS used
-- by this RPC, including the owner-only object_domains junction policy.
do $$ begin
  if current_database()<>'alcon_import_test' or to_regclass('public.elements') is not null then
    raise exception 'Use a fresh disposable alcon_import_test database';
  end if;
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
create table activity_spaces(id uuid primary key);
create table activity_space_members(activity_space_id uuid references activity_spaces,user_id uuid references auth.users,primary key(activity_space_id,user_id));
create table domains(id uuid primary key default gen_random_uuid(),name text,activity_space_id uuid references activity_spaces,user_id uuid references auth.users,privacy text default 'workspace');
create table domain_members(domain_id uuid references domains,user_id uuid references auth.users,role text,primary key(domain_id,user_id));
create table objects(id uuid primary key default gen_random_uuid(),name text,domain_id uuid references domains,user_id uuid references auth.users);
create table object_members(object_id uuid references objects,user_id uuid references auth.users,role text,primary key(object_id,user_id));
create table object_domains(object_id uuid references objects,domain_id uuid references domains,primary key(object_id,domain_id));
create table elements(id uuid primary key default gen_random_uuid(),object_id uuid references objects,title text,description text,status text,due_date date,progress smallint,owner_id uuid references auth.users,is_approval boolean default false,approval_state text);
create table element_objects(element_id uuid references elements,object_id uuid references objects,primary key(element_id,object_id));
create table workers(id uuid primary key default gen_random_uuid(),name text,status text default 'active',object_id uuid references objects,user_id uuid references auth.users);
create table element_assignees(id uuid primary key default gen_random_uuid(),element_id uuid references elements,worker_id uuid references workers,role text,unique(element_id,worker_id,role));
create function public.is_activity_space_member(x uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.activity_space_members where activity_space_id=x and user_id=auth.uid()) $$;
create function public.user_can_see_domain(x uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.domains d where d.id=x and (d.user_id=auth.uid() or exists(select 1 from public.domain_members m where m.domain_id=x and m.user_id=auth.uid()) or d.privacy='workspace' and public.is_activity_space_member(d.activity_space_id))) $$;
create function public.user_can_see_object(x uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.object_members m where m.object_id=x and m.user_id=auth.uid()) or exists(select 1 from public.objects o where o.id=x and public.user_can_see_domain(o.domain_id)) or exists(select 1 from public.object_domains od where od.object_id=x and public.user_can_see_domain(od.domain_id)) $$;
create function public.user_can_see_element(x uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.elements e where e.id=x and (e.owner_id=auth.uid() or public.user_can_see_object(e.object_id))) or exists(select 1 from public.element_objects eo where eo.element_id=x and public.user_can_see_object(eo.object_id)) $$;
alter table domains enable row level security;
create policy domain_select on domains for select to authenticated using(user_id=auth.uid() or public.user_can_see_domain(id));
create policy domain_insert on domains for insert to authenticated with check(user_id=auth.uid());
alter table objects enable row level security;
create policy object_select on objects for select to authenticated using(public.user_can_see_domain(domain_id) or exists(select 1 from object_members om where om.object_id=id and om.user_id=auth.uid()) or exists(select 1 from object_domains od where od.object_id=id and public.user_can_see_domain(od.domain_id)));
create policy object_insert on objects for insert to authenticated with check(auth.uid() is not null);
alter table domain_members enable row level security;
create policy domain_members_read on domain_members for select to authenticated using(user_id=auth.uid());
create policy domain_members_insert on domain_members for insert to authenticated with check(user_id=auth.uid());
alter table object_members enable row level security;
create policy object_members_read on object_members for select to authenticated using(user_id=auth.uid());
create policy object_members_insert on object_members for insert to authenticated with check(user_id=auth.uid());
alter table object_domains enable row level security;
create policy object_domains_owner on object_domains to authenticated using(exists(select 1 from domains d where d.id=domain_id and d.user_id=auth.uid()));
alter table elements enable row level security;
create policy element_select on elements for select to authenticated using(owner_id=auth.uid() or public.user_can_see_object(object_id) or exists(select 1 from element_objects eo where eo.element_id=id and public.user_can_see_object(eo.object_id)));
create policy element_insert on elements for insert to authenticated with check(owner_id=auth.uid() or public.user_can_see_object(object_id));
alter table element_objects enable row level security;
create policy element_objects_visible on element_objects to authenticated using(public.user_can_see_object(object_id) and public.user_can_see_element(element_id)) with check(public.user_can_see_object(object_id) and public.user_can_see_element(element_id));
alter table workers enable row level security;
create policy workers_authenticated on workers to authenticated using(auth.uid() is not null);
alter table element_assignees enable row level security;
create policy assignees_authenticated on element_assignees to authenticated using(auth.uid() is not null);
grant select,insert,update,delete on all tables in schema public to authenticated;

\ir ../migrations/20260906160003_import_existing_work.sql
-- Replaying the migration itself must not fail on its policies.
\ir ../migrations/20260906160003_import_existing_work.sql

begin;
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
insert into activity_spaces values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into activity_space_members values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
insert into domains(id,name,activity_space_id,user_id,privacy) values
 ('20000000-0000-0000-0000-000000000001','Shared','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','workspace'),
 ('20000000-0000-0000-0000-000000000002','Other Space','10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','private'),
 ('20000000-0000-0000-0000-000000000003','Private','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','private');
insert into objects(id,name,domain_id) values
 ('30000000-0000-0000-0000-000000000001','Existing','20000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','Secondary home','20000000-0000-0000-0000-000000000002'),
 ('30000000-0000-0000-0000-000000000003','Foreign','20000000-0000-0000-0000-000000000002'),
 ('30000000-0000-0000-0000-000000000004','Private','20000000-0000-0000-0000-000000000003');
insert into object_domains values('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
-- Production object SELECT policy sees object membership even though the
-- owner-only junction is not readable by this actor.
insert into object_members values('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','member');
insert into workers(id,name,status,user_id) values
 ('50000000-0000-0000-0000-000000000001','Member','active','00000000-0000-0000-0000-000000000002'),
 ('50000000-0000-0000-0000-000000000002','Inactive','inactive','00000000-0000-0000-0000-000000000002'),
 ('50000000-0000-0000-0000-000000000003','Outside','active','00000000-0000-0000-0000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);

do $$ declare
  s uuid := '10000000-0000-0000-0000-000000000001';
  b uuid := '90000000-0000-0000-0000-000000000001';
  r jsonb; again jsonb; payload jsonb; one jsonb;
  n integer; projects integer; containers integer; imported uuid;
begin
  select jsonb_agg(jsonb_build_object('rowKey','row-'||i,'sourceRow',i,'title','Work '||i,'status',case when i=1 then 'done' else 'todo' end,
    'description','<script>not executable</script>','worker_id','50000000-0000-0000-0000-000000000001','due_date','2028-02-29',
    'owner_id','00000000-0000-0000-0000-000000000003','is_approval',true,'approval_state','approved',
    'source',jsonb_build_object('id','EXT-'||i,'original_url','javascript:alert(1)'))) into payload from generate_series(1,100) i;
  r := import_existing_work(s,b,null,null,'First real project',payload);
  imported := (r->>'objectId')::uuid;
  assert jsonb_array_length(r->'saved')=100 and (r->>'replayed')::boolean=false, '100 rows committed together';
  assert (select count(*)=100 from elements where object_id=imported), 'Every row exists';
  assert (select count(*)=100 from element_objects where object_id=imported), 'Every primary home mirrored';
  assert (select count(*)=100 from element_assignees ea join elements e on e.id=ea.element_id where e.object_id=imported), 'Every Worker assignment exists';
  assert (select bool_and(owner_id is null and is_approval=false and approval_state is null) from elements where object_id=imported), 'External data cannot author personal ownership or approval';
  assert (select progress=100 from elements where object_id=imported and title='Work 1'), 'Done status and progress agree';
  assert (select description like '%<script>not executable</script>%' and description like '%Source URL: javascript:alert(1)%' and description like '%EXT-1%' from elements where object_id=imported and title='Work 1'), 'Source HTML and URL are literal text, not executable content';
  assert (select count(*)=1 from object_members where object_id=imported and user_id=auth.uid() and role='owner'), 'Project membership is attributed to authenticated actor';
  assert (select count(*)=1 from objects o join domain_members dm on dm.domain_id=o.domain_id where o.id=imported and dm.user_id=auth.uid() and dm.role='owner'), 'Auto-created General Domain has owner membership';
  n := (select count(*) from elements);
  again := import_existing_work(s,b,null,null,'First real project',payload);
  assert again->'saved'=r->'saved' and (again->>'replayed')::boolean, 'Retry returns exactly the same IDs';
  assert (select count(*) from elements)=n, 'Retry cannot duplicate work';
  begin
    perform import_existing_work(s,b,null,null,'Changed project',payload);
    raise exception 'Expected replay mismatch rejection';
  exception when raise_exception then
    if sqlerrm='Expected replay mismatch rejection' then raise; end if;
    assert sqlerrm like '%different contents%', 'Changed requests rejected';
  end;
  one := jsonb_build_array(jsonb_build_object('rowKey','one','title','One','status','todo','source','{}'::jsonb));
  r := import_existing_work(s,gen_random_uuid(),'30000000-0000-0000-0000-000000000001',null,'',one);
  assert r->>'objectId'='30000000-0000-0000-0000-000000000001', 'Existing primary Object accepted';
  assert (select count(*)=0 from object_domains where object_id='30000000-0000-0000-0000-000000000002'), 'Fixture truly hides secondary junction';
  r := import_existing_work(s,gen_random_uuid(),'30000000-0000-0000-0000-000000000002',null,'',one);
  assert r->>'objectId'='30000000-0000-0000-0000-000000000002', 'Visible secondary Object accepted despite junction RLS';
  r := import_existing_work(s,gen_random_uuid(),null,'20000000-0000-0000-0000-000000000001','Shared Domain project',one);
  assert (select domain_id='20000000-0000-0000-0000-000000000001' from objects where id=(r->>'objectId')::uuid), 'New project in another creator''s visible Domain accepted';
  assert (select count(*)=0 from object_domains where object_id=(r->>'objectId')::uuid), 'No unauthorized redundant junction write';
  projects := (select count(*) from objects); containers := (select count(*) from domains); n := (select count(*) from elements);
  begin
    perform import_existing_work(s,gen_random_uuid(),null,null,'Must roll back',one || jsonb_build_array(jsonb_build_object('rowKey','two','title','Bad date','status','todo','due_date','2026-02-30')));
    raise exception 'Expected invalid date';
  exception when datetime_field_overflow then null; end;
  assert (select count(*) from objects)=projects and (select count(*) from domains)=containers and (select count(*) from elements)=n, 'Later row failure rolls back project, Domain, first row and links';
  begin perform import_existing_work(s,gen_random_uuid(),null,null,'Empty','[]'); raise exception 'Expected empty';
  exception when raise_exception then if sqlerrm='Expected empty' then raise; end if; end;
  begin perform import_existing_work(s,gen_random_uuid(),null,null,'Too many',payload || one); raise exception 'Expected count bound';
  exception when raise_exception then if sqlerrm='Expected count bound' then raise; end if; end;
  begin perform import_existing_work(s,gen_random_uuid(),null,null,'Duplicate',one || one); raise exception 'Expected duplicate';
  exception when raise_exception then if sqlerrm='Expected duplicate' then raise; end if; end;
  begin perform import_existing_work(s,gen_random_uuid(),'30000000-0000-0000-0000-000000000003',null,'',one); raise exception 'Expected foreign rejection';
  exception when insufficient_privilege then null; end;
  begin perform import_existing_work(s,gen_random_uuid(),'30000000-0000-0000-0000-000000000004',null,'',one); raise exception 'Expected private rejection';
  exception when insufficient_privilege then null; end;
  begin perform import_existing_work(s,gen_random_uuid(),null,null,'Inactive',jsonb_set(one,'{0,worker_id}','"50000000-0000-0000-0000-000000000002"')); raise exception 'Expected inactive rejection';
  exception when insufficient_privilege then null; end;
  begin perform import_existing_work(s,gen_random_uuid(),null,null,'Outside',jsonb_set(one,'{0,worker_id}','"50000000-0000-0000-0000-000000000003"')); raise exception 'Expected outside rejection';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from objects)=projects and (select count(*) from domains)=containers and (select count(*) from elements)=n, 'Rejected requests leave no partial work';
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  assert (select count(*)=0 from work_import_receipts), 'Receipt payloads are private to their creator';
  begin perform import_existing_work('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',null,null,'Other actor','[{"rowKey":"x","title":"Other actor","status":"todo"}]'); raise exception 'Expected occupied batch';
  exception when unique_violation then null; end;
  assert (select count(*)=0 from objects where name='Other actor'), 'Hidden foreign batch collision rolls back';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
do $$ begin
  begin perform import_existing_work('10000000-0000-0000-0000-000000000001',gen_random_uuid(),null,null,'Nonmember','[{"rowKey":"x","title":"X","status":"todo"}]'); raise exception 'Expected member check';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin perform import_existing_work('10000000-0000-0000-0000-000000000001',gen_random_uuid(),null,null,'Anonymous','[{"rowKey":"x","title":"X","status":"todo"}]'); raise exception 'Expected auth check';
  exception when insufficient_privilege then null; end;
  assert not has_function_privilege('anon','public.import_existing_work(uuid,uuid,uuid,uuid,text,jsonb)','execute'), 'Anonymous cannot call the RPC';
end $$;
reset role;
-- A receipt must survive project deletion, otherwise a delayed retry could recreate it.
do $$ declare project uuid; begin
  select object_id into project from work_import_receipts where id='90000000-0000-0000-0000-000000000001';
  delete from element_assignees where element_id in(select id from elements where object_id=project);
  delete from element_objects where object_id=project;
  delete from elements where object_id=project;
  delete from object_members where object_id=project;
  delete from object_domains where object_id=project;
  delete from objects where id=project;
  assert exists(select 1 from work_import_receipts where id='90000000-0000-0000-0000-000000000001'), 'Receipt survives deleted work';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$ declare receipt work_import_receipts%rowtype; begin
  select * into receipt from work_import_receipts where id='90000000-0000-0000-0000-000000000001';
  begin perform import_existing_work(receipt.activity_space_id,receipt.id,null,null,'First real project',receipt.request->'rows'); raise exception 'Expected removed work rejection';
  exception when sqlstate 'P2002' then assert sqlerrm like '%removed%', 'Removed work is not recreated'; end;
  assert resolve_work_import(receipt.activity_space_id,receipt.id)='{"committed":true,"available":false}'::jsonb, 'Deleted work remains an explicitly confirmed prior commit';
end $$;
do $$ declare s uuid := '10000000-0000-0000-0000-000000000001'; b uuid := gen_random_uuid(); n integer; begin
  n := (select count(*) from elements);
  assert resolve_work_import(s,b)='{"committed":false,"available":false}'::jsonb, 'Missing receipt is atomically closed';
  assert resolve_work_import(s,b)='{"committed":false,"available":false}'::jsonb, 'Resolution retries are idempotent';
  begin perform import_existing_work(s,b,null,null,'Late request','[{"rowKey":"late","title":"Late request","status":"todo"}]'); raise exception 'Expected late request fenced';
  exception when sqlstate 'P2001' then null; end;
  assert (select count(*) from elements)=n, 'A late original request cannot create work after editing resumes';
  assert (select count(*)=0 from objects where name='Late request'), 'Late request cannot create a project';
end $$;
rollback;
select 'import_existing_work contracts passed' as result;

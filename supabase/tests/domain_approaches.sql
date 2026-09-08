-- LOCAL ONLY. Run in a fresh disposable database:
-- createdb alcon_approach_test
-- psql -v ON_ERROR_STOP=1 -d alcon_approach_test -f supabase/tests/domain_approaches.sql
\set ON_ERROR_STOP on
do $$ begin if current_database() <> 'alcon_approach_test' then raise exception 'Disposable alcon_approach_test database required'; end if; end $$;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,public to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
create table public.domains(id uuid primary key, user_id uuid);
create table public.domain_members(domain_id uuid,user_id uuid,role text);
create table public.strategies(id uuid primary key,created_by uuid);
create table public.objects(id uuid primary key,domain_id uuid);
create table public.object_domains(object_id uuid,domain_id uuid);
create table public.intents(id uuid primary key,strategy_id uuid,kind text);
create function public.user_has_domain_role(d uuid,roles text[]) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from domain_members where domain_id=d and user_id=auth.uid() and role=any(roles)) $$;
create function public.user_can_see_domain(d uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from domains where id=d and (user_id=auth.uid() or exists(select 1 from domain_members where domain_id=d and user_id=auth.uid()))) $$;
create function public.user_can_see_object(o uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from objects where id=o and (user_can_see_domain(domain_id) or exists(select 1 from object_domains where object_id=o and user_can_see_domain(domain_id)))) $$;
create function public.user_can_see_strategy(s uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from strategies where id=s and (created_by=auth.uid() or user_has_domain_role('10000000-0000-0000-0000-000000000001',array['owner','admin','member','guest']))) $$;
grant select on domains,objects,object_domains,intents,strategies to authenticated;
grant delete on objects to authenticated;
alter table domains enable row level security;
create policy domain_read on domains for select to authenticated using(user_can_see_domain(id));
alter table objects enable row level security;
create policy object_read on objects for select to authenticated using(user_can_see_object(id));
create policy object_delete on objects for delete to authenticated using(auth.uid()='00000000-0000-0000-0000-000000000003');
insert into auth.users select ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid from generate_series(1,4) n;
insert into domains values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004');
insert into domain_members values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','admin'),('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','guest');
insert into strategies values('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
insert into objects values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
insert into intents values('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','measure');
\ir ../migrations/20260908153210_domain_approach_reviews.sql
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
insert into domain_approaches(id,domain_id,strategy_id,title,expected_change,hypothesis,measure_id) values('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Validate demand','Learn if visitors want it','Prototype plus interviews establish demand','40000000-0000-0000-0000-000000000001');
insert into approach_conditions(id,approach_id,title,kind,success_criteria) values('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','Visitors understand the concept','learning','Observe participants describing its value');
insert into approach_contributions(approach_id,condition_id,object_id,role,rationale) values('50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','alternative','A video can illustrate the concept');
insert into approach_assessments(approach_id,condition_id,plan_revision,result,observation,evidence_source,observed_on,reasoning,author_id) select id,'60000000-0000-0000-0000-000000000001',plan_revision,'met','Participants explained value','Interview notes',current_date,'Evidence supports comprehension','00000000-0000-0000-0000-000000000004' from domain_approaches;
insert into approach_reviews(approach_id,expected_revision,action,reasoning,snapshot) select id,revision,'continue','Continue to demand test','{"forged":true}' from domain_approaches;
do $$ declare a domain_approaches; r approach_reviews; begin
  select * into a from domain_approaches;
  select * into r from approach_reviews;
  if a.plan_revision<>3 or a.revision<>5 then raise exception 'Incorrect revision transitions'; end if;
  if r.snapshot ? 'forged' or jsonb_array_length(r.snapshot->'assessments')<>1 then raise exception 'Review snapshot not derived by server'; end if;
  if exists(select 1 from approach_assessments where author_id<>auth.uid()) then raise exception 'Spoofed author accepted'; end if;
  begin
    insert into approach_reviews(approach_id,expected_revision,action,reasoning) values(a.id,1,'stop','stale');
    raise exception 'Stale review accepted'; exception when raise_exception then if sqlerrm='Stale review accepted' then raise; end if; end;
  begin
    perform edit_approach_plan_item('condition','60000000-0000-0000-0000-000000000001',1,'{}');
    raise exception 'Stale edit accepted'; exception when raise_exception then if sqlerrm='Stale edit accepted' then raise; end if; end;
  begin
    insert into approach_contributions(approach_id,condition_id,object_id,role,rationale) values(a.id,'60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','primary','hidden');
    raise exception 'Hidden Object accepted'; exception when raise_exception then if sqlerrm='Hidden Object accepted' then raise; end if; end;
  begin update approach_reviews set reasoning='rewritten'; raise exception 'Audit update allowed'; exception when insufficient_privilege then null; end;
  begin delete from approach_assessments; raise exception 'Audit deletion allowed'; exception when insufficient_privilege then null; end;
end $$;
-- Admin edits invalidate earlier evaluations, preserving history.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select edit_approach_plan_item('condition','60000000-0000-0000-0000-000000000001',5,'{"title":"Demonstrate real demand","kind":"outcome","required":true,"success_criteria":"Observe an actual commitment","review_date":null}');
do $$ declare a domain_approaches; begin select * into a from domain_approaches;
  if a.plan_revision<>4 or a.revision<>6 then raise exception 'Admin edit not versioned'; end if;
  if (select snapshot->'conditions'->0->>'title' from approach_reviews)<>'Visitors understand the concept' then raise exception 'Historical basis changed'; end if;
  begin insert into approach_assessments(approach_id,condition_id,plan_revision,result,observation,evidence_source,observed_on,reasoning) values(a.id,'60000000-0000-0000-0000-000000000001',3,'met','Old evidence','Old context',current_date,'Old judgment'); raise exception 'Stale assessment accepted'; exception when raise_exception then if sqlerrm='Stale assessment accepted' then raise; end if; end;
end $$;
-- Disconnecting current work versions the plan and keeps the prior decision basis.
select edit_approach_plan_item('disconnect',(select id from approach_contributions),6,'{}');
do $$ begin
  if (select count(*) from approach_contributions)<>0 then raise exception 'Connection not removed'; end if;
  if (select plan_revision from domain_approaches)<>5 then raise exception 'Disconnect did not invalidate old evidence'; end if;
  if (select jsonb_array_length(snapshot->'contributions') from approach_reviews)<>1 then raise exception 'Disconnect erased historical context'; end if;
end $$;
-- Reconnect, then exercise a normal Object deletion by a non-admin reader.
insert into approach_contributions(approach_id,condition_id,object_id,role,rationale) values('50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','primary','New connection');
-- A guest reads both the approach and its evidence, but cannot judge or edit.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin
  if (select count(*) from approach_reviews)<>1 then raise exception 'Guest cannot read visible history'; end if;
  begin insert into approach_reviews(approach_id,expected_revision,action,reasoning) select id,revision,'stop','guest' from domain_approaches; raise exception 'Guest wrote review'; exception when insufficient_privilege then null; when raise_exception then if sqlerrm='Guest wrote review' then raise; end if; end;
end $$;
delete from objects where id='30000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from approach_contributions)<>0 then raise exception 'Object cascade failed'; end if;
  if (select plan_revision from domain_approaches)<>7 then raise exception 'Object cascade did not version the approach'; end if;
  if has_function_privilege('authenticated',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='alcon_approach_internal' and p.proname='version_after_contribution_delete'),'EXECUTE') then raise exception 'Internal trigger exposed'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
do $$ begin
  if (select count(*) from domain_approaches)+(select count(*) from approach_assessments)+(select count(*) from approach_reviews)<>0 then raise exception 'Outsider data leak'; end if;
end $$;
reset role;
begin;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
insert into objects values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
insert into approach_contributions(approach_id,condition_id,object_id,role,rationale) values('50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','primary','Cascade fixture');
delete from domains where id='10000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from domain_approaches)+(select count(*) from approach_conditions)+(select count(*) from approach_reviews)<>0 then raise exception 'Domain cascade failed'; end if;
end $$;
rollback;
select 'Domain approach persistence and permissions passed' as result;

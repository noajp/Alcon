-- Rollback regression suite for the disposable fixture database.
-- After fixture + coordination_core + check_in_http_conflict migrations:
-- psql -v ON_ERROR_STOP=1 -d alcon_coordination_test -f supabase/tests/coordination_core.sql
begin;
do $$ begin
  if current_database()<>'alcon_coordination_test' then raise exception 'Use the disposable coordination fixture database'; end if;
end $$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into activity_space_members values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
insert into workers(id,name,user_id) values ('50000000-0000-0000-0000-000000000002','Unassigned member','00000000-0000-0000-0000-000000000001');
insert into profiles values ('00000000-0000-0000-0000-000000000001','Check-in author');
insert into domains(id,activity_space_id,user_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
insert into objects(id,name,domain_id,visible) values
 ('30000000-0000-0000-0000-000000000001','Current','10000000-0000-0000-0000-000000000001',true),
 ('30000000-0000-0000-0000-000000000002','Other Space','10000000-0000-0000-0000-000000000002',true),
 ('30000000-0000-0000-0000-000000000003','Hidden','10000000-0000-0000-0000-000000000001',false),
 ('30000000-0000-0000-0000-000000000004','Multi home','10000000-0000-0000-0000-000000000002',true);
insert into object_domains values ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001');
insert into elements(id,title,object_id,status,updated_at,direction) values
 ('40000000-0000-0000-0000-000000000001','One','30000000-0000-0000-0000-000000000001','todo','2026-01-01','{"intent":"Keep this","next":"Old"}'),
 ('40000000-0000-0000-0000-000000000002','Two','30000000-0000-0000-0000-000000000004','todo','2026-01-01',null),
 ('40000000-0000-0000-0000-000000000003','External secret','30000000-0000-0000-0000-000000000002','todo','2026-01-01',null),
 ('40000000-0000-0000-0000-000000000004','Hidden secret','30000000-0000-0000-0000-000000000003','todo','2026-01-01',null),
 ('40000000-0000-0000-0000-000000000005','No home',null,'todo','2026-01-01',null),
 ('40000000-0000-0000-0000-000000000006','Personal',null,'todo','2026-01-01',null);
update elements set owner_id='00000000-0000-0000-0000-000000000001' where id='40000000-0000-0000-0000-000000000006';
insert into element_objects values ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
insert into workers(id,name,user_id) values ('50000000-0000-0000-0000-000000000001','Other worker','00000000-0000-0000-0000-000000000002');
insert into element_assignees values ('60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','assignee');
insert into element_edges(from_element,to_element,edge_type,attributes) values
 ('40000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','depends_on','{"secret":"Other Space detail"}'),
 ('40000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','depends_on','{"secret":"Hidden detail"}');
-- Exceeds the standard PostgREST row cap: scalar aggregate must remain complete.
insert into elements(id,title,object_id,status,updated_at)
 select gen_random_uuid(),'Bulk '||i,'30000000-0000-0000-0000-000000000001',null,'2026-01-01' from generate_series(1,1200) i;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $tests$
declare
  r jsonb;
  replay jsonb;
  stamp timestamptz;
  original_stamp timestamptz;
  v_count int;
  e1 uuid := '40000000-0000-0000-0000-000000000001';
  e2 uuid := '40000000-0000-0000-0000-000000000002';
  space1 uuid := '20000000-0000-0000-0000-000000000001';
  req uuid := '70000000-0000-0000-0000-000000000001';
begin
  select count(*) into v_count from object_domains;
  assert v_count=0, 'Fixture must reproduce owner-only junction RLS';
  r := get_now_work(space1);
  assert jsonb_array_length(r->'elements')=1202, 'Complete read, secondary Space home, dedup, and personal/unhomed exclusion';
  assert jsonb_array_length(r->'objects')=2, 'Only visible Space Objects';
  assert jsonb_array_length(r->'workers')=2, 'Assigned workers and unassigned current Space member workers';
  assert jsonb_array_length(r->'edges')=2, 'Opaque prerequisite edges retained';
  assert not r::text like '%secret%', 'Opaque edges must not leak external names or attributes';
  assert (select bool_and(x->'attributes'='{}'::jsonb and x->'created_by'='null'::jsonb) from jsonb_array_elements(r->'edges') x), 'Opaque attributes redacted';
  assert (select jsonb_array_length(x->'assignees')=1 from jsonb_array_elements(r->'elements') x where x->>'id'=e1::text), 'All assignees';
  insert into element_objects values ('40000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000001');
  assert jsonb_array_length(get_now_work(space1)->'elements')=1203, 'Owned Elements homed in visible Space Objects remain in Now';
  assert coordination_element_in_space('40000000-0000-0000-0000-000000000006',space1), 'Owned homed Elements can participate in dependencies';
  delete from element_objects where element_id='40000000-0000-0000-0000-000000000006';
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
  assert jsonb_array_length(get_now_work(space1)->'workers')=1, 'Guests do not read unrelated Space member workers';
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
  -- Permission and payload failures do not change the element or create comments.
  begin perform check_in_element('40000000-0000-0000-0000-000000000004','2026-01-01',req,'{}','hidden'); raise exception 'Expected permission error'; exception when sqlstate '42501' then null; end;
  begin perform check_in_element(e1,'2025-01-01',req,'{}','stale'); raise exception 'Expected HTTP conflict without automatic transaction retries'; exception when sqlstate 'PT409' then null; end;
  begin perform check_in_element(e1,'2026-01-01',req,'{}',''); raise exception 'Expected no-op rejection'; exception when sqlstate '22023' then null; end;
  begin perform check_in_element(e1,'2026-01-01',req,'{"status":null}',''); raise exception 'Expected invalid status rejection'; exception when sqlstate '22023' then null; end;
  begin perform check_in_element(e1,'2026-01-01',req,'{}',repeat('x',4001)); raise exception 'Expected note limit'; exception when sqlstate '22023' then null; end;
  begin perform check_in_element(e1,'2026-01-01',req,jsonb_build_object('next',repeat('x',2001)),''); raise exception 'Expected next limit'; exception when sqlstate '22023' then null; end;
  assert (select count(*)=0 from element_comments), 'Failed calls are atomic';
  r := check_in_element(e1,'2026-01-01',req,'{"status":"blocked","next":"Ask for the input"}','Waiting on input');
  stamp := (r->'element'->>'updated_at')::timestamptz;
  original_stamp := stamp;
  assert r->'element'->'direction'->>'intent'='Keep this', 'Other direction fields preserved';
  assert r->'element'->'direction'->>'next'='Ask for the input', 'Next persisted';
  assert r->'comment'->>'content' like '%Status:%' and r->'comment'->>'content' like '%Next:%' and r->'comment'->>'content' like '%Waiting on input%', 'One shared status, next, and note';
  assert (select count(*)=1 from notifications where kind='comment'), 'One shared comment notification';
  assert (select count(*)=0 from notifications where kind='status_change'), 'No duplicate status notification';
  replay := check_in_element(e1,'2026-01-01',req,'{"status":"blocked","next":"Ask for the input"}','Waiting on input');
  assert replay->>'replayed'='true' and replay->'element'->>'updated_at'=r->'element'->>'updated_at', 'Idempotent retry';
  assert (select count(*)=1 from element_comments), 'Retry cannot duplicate comment';
  begin perform check_in_element(e1,'2026-01-01',req,'{}','Different'); raise exception 'Expected request mismatch'; exception when sqlstate '22023' then null; end;
  update element_comments set content='Edited',updated_at=clock_timestamp() where id=req;
  begin perform check_in_element(e1,'2026-01-01',req,'{"status":"blocked","next":"Ask for the input"}','Waiting on input'); raise exception 'Expected edited replay failure'; exception when sqlstate 'P0002' then null; end;
  delete from element_comments where id=req;
  begin perform check_in_element(e1,'2026-01-01',req,'{"status":"blocked","next":"Ask for the input"}','Waiting on input'); raise exception 'Expected deleted replay failure'; exception when sqlstate 'P0002' then null; end;
  assert (select updated_at=original_stamp from elements where id=e1), 'Deleted retry cannot reapply update';
  r := check_in_element(e1,stamp,gen_random_uuid(),'{"next":null}','');
  stamp := (r->'element'->>'updated_at')::timestamptz;
  assert not (r->'element'->'direction' ? 'next') and r->'element'->'direction'->>'intent'='Keep this', 'Clear next only';
  r := check_in_element(e1,stamp,gen_random_uuid(),'{}','Note only works');
  stamp := (r->'element'->>'updated_at')::timestamptz;
  assert r->'element'->>'status'='blocked', 'Note-only preserves status';
  update elements set is_approval=true,approval_state='pending' where id=e1;
  begin perform check_in_element(e1,stamp,gen_random_uuid(),'{"status":"done"}',''); raise exception 'Expected approval gate'; exception when sqlstate '22023' then null; end;
  update elements set approval_state='approved' where id=e1;
  r := check_in_element(e1,stamp,gen_random_uuid(),'{"status":"done"}','');
  assert r->'element'->>'progress'='100', 'Approved completion updates progress';
  -- A client-forged marker is insufficient to suppress an ordinary update.
  perform set_config('alcon.check_in_request',gen_random_uuid()::text,true);
  update elements set status='blocked',updated_at=clock_timestamp() where id=e1;
  assert (select count(*)=1 from notifications where kind='status_change'), 'Other update path keeps original notification';
  perform set_element_dependency(space1,e1,e2,false);
  perform set_element_dependency(space1,e1,e2,false);
  assert (select count(*)=1 from element_edges where from_element=e1 and to_element=e2), 'Dependency retry deduplicates';
  begin perform set_element_dependency(space1,e2,e1,false); raise exception 'Expected cycle rejection'; exception when sqlstate '22023' then null; end;
  begin perform set_element_dependency(space1,e1,e1,false); raise exception 'Expected self rejection'; exception when sqlstate '22023' then null; end;
  begin perform set_element_dependency(space1,e1,'40000000-0000-0000-0000-000000000003',false); raise exception 'Expected cross Space rejection'; exception when sqlstate '42501' then null; end;
  begin perform set_element_dependency(space1,e1,'40000000-0000-0000-0000-000000000004',false); raise exception 'Expected hidden rejection'; exception when sqlstate '42501' then null; end;
  perform set_element_dependency(space1,e1,e2,true);
  assert not exists(select 1 from element_edges where from_element=e1 and to_element=e2), 'Remove dependency';
  -- Immutable receipt and its transaction identity are inaccessible to callers.
  begin update element_check_ins set note='forge' where request_id=req; raise exception 'Expected immutable receipt'; exception when sqlstate '42501' then null; end;
  begin delete from element_check_ins where request_id=req; raise exception 'Expected durable receipt'; exception when sqlstate '42501' then null; end;
  begin insert into element_check_ins(request_id,element_id,author_id,patch,note,comment_id,comment_content,result_updated_at,transaction_id)
    values(gen_random_uuid(),e1,auth.uid(),'{}','',gen_random_uuid(),'forge',now(),pg_current_xact_id()); raise exception 'Expected server-owned txid'; exception when sqlstate '42501' then null; end;
  raise notice 'Coordination regression tests passed';
end;
$tests$;
reset role;
set local role anon;
do $$ begin
  begin perform public.get_now_work('20000000-0000-0000-0000-000000000001'); raise exception 'Expected anonymous denial'; exception when sqlstate '42501' then null; end;
end $$;
rollback;

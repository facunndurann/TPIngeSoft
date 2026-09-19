-- psql -v ON_ERROR_STOP=1 ... -f supabase/tests/employee-accounts.sql
-- All fixtures are rolled back. Run after every migration.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %',message; end if; end; $$;
create function pg_temp.denied(statement text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when insufficient_privilege then return;
    when raise_exception then if sqlerrm='FORBIDDEN' then return; end if; raise;
  end;
  raise exception 'Unexpected authorization: %',statement;
end; $$;
create temp table fixture(key text primary key,id uuid default gen_random_uuid());
insert into fixture(key) values('owner'),('manager'),('waiter'),('kitchen'),('cashier'),('duplicate'),
 ('restaurant'),('other'),('branch'),('second'),('foreign'),('table'),('table2'),('foreign_table'),
 ('session'),('session2'),('foreign_session'),('order'),('order2'),('foreign_order'),('legacy');
grant select on fixture to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from fixture where key=k$$;
insert into auth.users(id,aud,role) select id,'authenticated','authenticated' from fixture
 where key in ('owner','manager','waiter','kitchen','cashier','duplicate');
insert into public.restaurants(id,name,slug) select id,key,id::text from fixture where key in ('restaurant','other');
insert into public.restaurant_members(restaurant_id,user_id,role)
 values(pg_temp.id('restaurant'),pg_temp.id('owner'),'owner'),(pg_temp.id('other'),pg_temp.id('owner'),'owner');
insert into public.branches(id,restaurant_id,name) values
 (pg_temp.id('branch'),pg_temp.id('restaurant'),'Main'),(pg_temp.id('second'),pg_temp.id('restaurant'),'Second'),
 (pg_temp.id('foreign'),pg_temp.id('other'),'Other');
insert into public.pos_employees(id,restaurant_id,full_name,pin_hash)
 values(pg_temp.id('legacy'),pg_temp.id('restaurant'),'Legacy Person','historical-hash');
insert into public.pos_audit_log(restaurant_id,employee_id,action)
 values(pg_temp.id('restaurant'),pg_temp.id('legacy'),'historical');

select public.save_employee_account(pg_temp.id('owner'),pg_temp.id('restaurant'),pg_temp.id('waiter'),
 'Same Name',array['waiter']::public.member_role[],array[pg_temp.id('branch')],true,' Test.Waiter ',pg_temp.id('legacy'));
select public.save_employee_account(pg_temp.id('owner'),pg_temp.id('restaurant'),pg_temp.id('kitchen'),
 'Same Name',array['kitchen']::public.member_role[],array[pg_temp.id('branch')],true,'test.kitchen');
select public.save_employee_account(pg_temp.id('owner'),pg_temp.id('restaurant'),pg_temp.id('cashier'),
 'Cashier',array['cashier']::public.member_role[],array[pg_temp.id('branch')],true,'test.cashier');
select public.save_employee_account(pg_temp.id('owner'),pg_temp.id('restaurant'),pg_temp.id('manager'),
 'Manager',array['manager']::public.member_role[],array[pg_temp.id('branch')],true,'test.manager');
select pg_temp.assert_true((select count(*)=2 from public.profiles where full_name='Same Name'),'duplicate display names allowed');
select pg_temp.assert_true((select username_normalized='test.waiter' from public.profiles where id=pg_temp.id('waiter')),'username normalization');
do $$begin
 begin
  perform public.save_employee_account(pg_temp.id('owner'),pg_temp.id('other'),pg_temp.id('duplicate'),
   'Another Person',array['waiter']::public.member_role[],array[pg_temp.id('foreign')],true,'TEST.WAITER');
  raise exception 'Duplicate username was accepted';
 exception when unique_violation then null; end;
end;$$;
select pg_temp.assert_true(not exists(select 1 from public.profiles where id=pg_temp.id('duplicate')),
 'failed provisioning leaves no partial profile');
select pg_temp.assert_true(not exists(select 1 from public.restaurant_members where user_id=pg_temp.id('duplicate')),
 'failed provisioning leaves no partial membership');
select pg_temp.assert_true((select count(*)=1 from public.pos_audit_log where action='historical'),'legacy audit preserved');
select pg_temp.assert_true((select not is_active and migrated_user_id=pg_temp.id('waiter') from public.pos_employees where id=pg_temp.id('legacy')),'legacy disabled atomically');
select pg_temp.denied(format('select public.save_employee_account(%L,%L,%L,%L,array[''owner'']::public.member_role[],array[%L]::uuid[],true,%L)',
 pg_temp.id('manager'),pg_temp.id('restaurant'),pg_temp.id('duplicate'),'Escalation',pg_temp.id('branch'),'escalation'));
select pg_temp.denied(format('select public.save_employee_account(%L,%L,%L,%L,array[''waiter'']::public.member_role[],array[%L]::uuid[],true,%L)',
 pg_temp.id('owner'),pg_temp.id('restaurant'),pg_temp.id('duplicate'),'Cross branch',pg_temp.id('foreign'),'cross.branch'));

insert into public.tables(id,restaurant_id,branch_id,label) values
 (pg_temp.id('table'),pg_temp.id('restaurant'),pg_temp.id('branch'),'Main'),
 (pg_temp.id('table2'),pg_temp.id('restaurant'),pg_temp.id('second'),'Second'),
 (pg_temp.id('foreign_table'),pg_temp.id('other'),pg_temp.id('foreign'),'Foreign');
insert into public.table_sessions(id,restaurant_id,table_id) values
 (pg_temp.id('session'),pg_temp.id('restaurant'),pg_temp.id('table')),
 (pg_temp.id('session2'),pg_temp.id('restaurant'),pg_temp.id('table2')),
 (pg_temp.id('foreign_session'),pg_temp.id('other'),pg_temp.id('foreign_table'));
insert into public.orders(id,restaurant_id,session_id,status,total_amount) values
 (pg_temp.id('order'),pg_temp.id('restaurant'),pg_temp.id('session'),'submitted',10),
 (pg_temp.id('order2'),pg_temp.id('restaurant'),pg_temp.id('session2'),'submitted',10),
 (pg_temp.id('foreign_order'),pg_temp.id('other'),pg_temp.id('foreign_session'),'submitted',10);

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('waiter')::text,true);
select pg_temp.assert_true((select count(*)=1 from public.get_pos_contexts()),'one context resolved');
select pg_temp.assert_true((select count(*)=1 from public.orders),'order RLS by tenant and branch');
select pg_temp.assert_true((select count(*)=1 from public.table_sessions),'session RLS by tenant and branch');
select pg_temp.assert_true((select count(*)=1 from public.branches),'branch RLS');
select pg_temp.assert_true((select count(*)=1 from public.tables),'table RLS');
select pg_temp.assert_true((select count(*)=1 from public.restaurants),'restaurant RLS');
select pg_temp.assert_true((select count(*)=0 from public.session_bills),'waiter cannot read cash aggregates');
select pg_temp.denied(format('select public.pos_close_table_session(%L)',pg_temp.id('session')));
select pg_temp.denied(format('select public.close_table_session(%L)',pg_temp.id('session')));
select pg_temp.denied(format('select public.pos_transition_order(%L,''accepted'')',pg_temp.id('order2')));
select pg_temp.denied(format('select public.pos_transition_order(%L,''accepted'')',pg_temp.id('foreign_order')));
select pg_temp.denied(format('select public.pos_transition_order(%L,''accepted'')',gen_random_uuid()));
select pg_temp.denied(format('select public.verify_pos_pin(%L,''1234'')',pg_temp.id('restaurant')));
select pg_temp.denied(format('select public.list_employee_accounts(%L)',pg_temp.id('restaurant')));
select pg_temp.denied(format('insert into public.restaurant_members(restaurant_id,user_id,role) values(%L,%L,''owner'')',pg_temp.id('other'),pg_temp.id('waiter')));
select pg_temp.denied(format('select public.save_employee_account(%L,%L,%L,''Forged'',array[''manager'']::public.member_role[],array[%L]::uuid[],true,''forged'')',pg_temp.id('owner'),pg_temp.id('restaurant'),pg_temp.id('waiter'),pg_temp.id('branch')));
select pg_temp.assert_true(not has_function_privilege('authenticated','public.record_pos_action(uuid,uuid,text,uuid,uuid,jsonb)','execute'),'audit forgery denied');
select pg_temp.assert_true(not public.has_permission(pg_temp.id('restaurant'),'admin.manage'),'waiter cannot manage menu/configuration');
select public.pos_transition_order(pg_temp.id('order'),'accepted');
select pg_temp.denied(format('select public.transition_order(%L,''in_preparation'')',pg_temp.id('order')));

select set_config('request.jwt.claim.sub',pg_temp.id('kitchen')::text,true);
select pg_temp.assert_true(not public.has_permission(pg_temp.id('restaurant'),'floor.read'),'kitchen has no floor permission');
select pg_temp.denied(format('select public.dispatch_internal_order(%L)',pg_temp.id('order')));
select public.pos_transition_order(pg_temp.id('order'),'in_preparation');
select public.pos_transition_order(pg_temp.id('order'),'ready');
select pg_temp.denied(format('select public.pos_transition_order(%L,''delivered'')',pg_temp.id('order')));
select pg_temp.denied(format('select public.pos_transition_order(%L,''cancelled'')',pg_temp.id('order')));
select pg_temp.denied(format('select public.pos_transition_order(%L,''in_preparation'')',pg_temp.id('order')));
select set_config('request.jwt.claim.sub',pg_temp.id('waiter')::text,true);
select public.pos_transition_order(pg_temp.id('order'),'delivered');
select set_config('request.jwt.claim.sub',pg_temp.id('kitchen')::text,true);
select pg_temp.assert_true((select count(*)=0 from public.orders),'kitchen cannot read completed history');
select set_config('request.jwt.claim.sub',pg_temp.id('cashier')::text,true);
select public.pos_close_table_session(pg_temp.id('session'));
select public.pos_close_table_session(pg_temp.id('session'));
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
select pg_temp.assert_true((select count(*)=0 from public.get_pos_contexts()),'owner has no POS fallback');
select pg_temp.denied(format('select public.pos_close_table_session(%L)',pg_temp.id('session2')));
select pg_temp.assert_true((select count(*)=5 from public.pos_audit_log where action in ('order.transition','session.closed') and actor_user_id is not null and branch_id=pg_temp.id('branch')),'new audit attribution and idempotent close');
reset role;

-- Additional restaurant/branch assignments and immediate revocation.
select public.save_employee_account(pg_temp.id('owner'),pg_temp.id('other'),pg_temp.id('waiter'),
 'Same Name',array['waiter']::public.member_role[],array[pg_temp.id('foreign')],true);
select set_config('request.jwt.claim.sub',pg_temp.id('waiter')::text,true);
select pg_temp.assert_true((select count(*)=2 from public.get_pos_contexts()),'multiple own contexts');
update public.restaurant_members set is_active=false where user_id=pg_temp.id('waiter');
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.get_pos_contexts()),'disabled memberships have no contexts');
select pg_temp.assert_true((select count(*)=0 from public.orders),'existing JWT loses data access immediately');
select pg_temp.denied(format('select public.pos_transition_order(%L,''accepted'')',pg_temp.id('foreign_order')));
reset role;
rollback;

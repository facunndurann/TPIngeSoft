-- Legacy PIN endpoints are retired; account/RLS coverage is in employee-accounts.sql.
begin;
do $$
begin
  if has_function_privilege('authenticated','public.verify_pos_pin(uuid,text)','execute')
    or has_function_privilege('authenticated','public.upsert_pos_employee(uuid,text,text,uuid,boolean)','execute')
    or has_function_privilege('authenticated','public.delete_pos_employee(uuid,uuid)','execute')
  then raise exception 'Legacy PIN endpoints remain callable'; end if;
  if has_column_privilege('authenticated','public.pos_employees','pin_hash','select')
    or has_table_privilege('authenticated','public.pos_audit_log','insert')
    or has_table_privilege('authenticated','public.pos_audit_log','update')
    or has_table_privilege('authenticated','public.pos_audit_log','delete')
  then raise exception 'Legacy secrets or audit writes exposed'; end if;
  if to_regprocedure('public.pos_transition_order(uuid,public.order_status,uuid)') is not null
    or to_regprocedure('public.pos_close_table_session(uuid,uuid)') is not null
  then raise exception 'Client can still supply employee identity'; end if;
end;
$$;
rollback;

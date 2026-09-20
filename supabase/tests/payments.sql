-- MI-49: ledger, RPC POS y saldo aprobado. Independiente del seed y reversible.
begin;

create function pg_temp.expect_payment_error(
  sid uuid, amount numeric, method public.payment_method, mode public.payment_mode,
  participant uuid, reference text, expected text
) returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.pos_record_payment(sid, amount, method, mode, participant, reference);
  exception when others then actual := sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'Expected %, got %', expected, coalesce(actual, 'success');
  end if;
end;
$$;

do $$
declare
  operator_id uuid := gen_random_uuid();
  diner uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  restaurant uuid;
  branch uuid;
  table_id uuid;
  sid uuid;
  participant uuid;
  payment_id uuid;
  bill record;
begin
  insert into auth.users(id, aud, role) values
    (operator_id, 'authenticated', 'authenticated'),
    (diner, 'authenticated', 'authenticated'),
    (outsider, 'authenticated', 'authenticated');
  insert into public.restaurants(name, slug)
    values('Payment SQL test', gen_random_uuid()::text) returning id into restaurant;
  insert into public.branches(restaurant_id, name)
    values(restaurant, 'Branch') returning id into branch;
  insert into public.tables(restaurant_id, branch_id, label)
    values(restaurant, branch, 'Table') returning id into table_id;
  insert into public.table_sessions(restaurant_id, table_id)
    values(restaurant, table_id) returning id into sid;
  insert into public.session_participants(session_id, user_id, display_name)
    values(sid, diner, 'Diner') returning id into participant;
  insert into public.orders(restaurant_id, session_id, submitted_by, total_amount, status)
    values(restaurant, sid, participant, 10, 'accepted');

  insert into public.restaurant_members(restaurant_id, user_id, role)
    values(restaurant, operator_id, 'cashier');
  insert into public.profiles(id, username_normalized, full_name)
    values(operator_id, replace(operator_id::text, '-', ''), 'Cashier');
  insert into public.branch_memberships(membership_id, restaurant_id, branch_id)
    select id, restaurant, branch from public.restaurant_members
    where restaurant_id = restaurant and user_id = operator_id;

  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_payment_error(sid, 1, 'external', 'custom', null, null, 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', diner::text, true);
  perform pg_temp.expect_payment_error(sid, 1, 'external', 'custom', participant, null, 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_payment_error(sid, 1, 'external', 'custom', null, null, 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', operator_id::text, true);

  perform pg_temp.expect_payment_error(sid, 0, 'external', 'custom', null, null, 'INVALID_PAYMENT_AMOUNT');
  perform pg_temp.expect_payment_error(sid, 'NaN', 'external', 'custom', null, null, 'INVALID_PAYMENT_AMOUNT');
  perform pg_temp.expect_payment_error(sid, 'Infinity', 'external', 'custom', null, null, 'INVALID_PAYMENT_AMOUNT');
  perform pg_temp.expect_payment_error(sid, 1.001, 'external', 'custom', null, null, 'INVALID_PAYMENT_AMOUNT');
  perform pg_temp.expect_payment_error(sid, 11, 'external', 'custom', null, null, 'PAYMENT_EXCEEDS_BALANCE');
  perform pg_temp.expect_payment_error(sid, 1, 'mobile', 'custom', null, null, 'PAYMENT_METHOD_DISABLED');
  perform pg_temp.expect_payment_error(sid, 1, 'external', 'custom', gen_random_uuid(), null, 'INVALID_PARTICIPANT');

  payment_id := public.pos_record_payment(sid, 4, 'in_person', 'custom', participant, 'receipt-1');
  if not exists(
    select 1 from public.payments where id = payment_id and restaurant_id = restaurant
      and session_id = sid and participant_id = participant and amount = 4
      and mode = 'custom' and method = 'in_person' and status = 'approved'
      and external_reference = 'receipt-1'
  ) then raise exception 'Payment ledger row was not recorded correctly'; end if;
  if not exists(
    select 1 from public.pos_audit_log where session_id = sid and action = 'payment.recorded'
      and actor_user_id = operator_id and branch_id = branch
      and details->>'paymentId' = payment_id::text
  ) then raise exception 'Payment audit was not recorded'; end if;

  select * into bill from public.session_bills where session_id = sid;
  if bill.total_amount <> 10 or bill.paid_amount <> 4 or bill.pending_amount <> 6 or bill.is_settled
    then raise exception 'First approved payment produced a wrong bill: %', to_jsonb(bill); end if;

  -- Estados no aprobados son parte del historial, nunca crédito disponible.
  insert into public.payments(
    restaurant_id, session_id, participant_id, amount, mode, method, status, external_reference
  ) values
    (restaurant, sid, participant, 2, 'custom', 'mobile', 'pending', 'provider-pending'),
    (restaurant, sid, participant, 2, 'custom', 'mobile', 'rejected', 'provider-rejected');
  select * into bill from public.session_bills where session_id = sid;
  if bill.paid_amount <> 4 or bill.pending_amount <> 6 or bill.is_settled
    then raise exception 'Pending/rejected payments changed the balance'; end if;

  perform pg_temp.expect_payment_error(sid, 1, 'in_person', 'custom', null, 'receipt-1', 'PAYMENT_REFERENCE_CONFLICT');
  update public.branches set payment_methods = '{mobile,external}' where id = branch;
  perform pg_temp.expect_payment_error(sid, 1, 'in_person', 'custom', null, null, 'PAYMENT_METHOD_DISABLED');
  perform pg_temp.expect_payment_error(sid, 1, 'mobile', 'custom', null, null, 'PAYMENT_METHOD_UNAVAILABLE');

  payment_id := public.pos_record_payment(sid, 6, 'external', 'full', null, 'cash-2');
  select * into bill from public.session_bills where session_id = sid;
  if bill.paid_amount <> 10 or bill.pending_amount <> 0 or not bill.is_settled
    then raise exception 'Settled bill is incorrect: %', to_jsonb(bill); end if;
  perform pg_temp.expect_payment_error(sid, 1, 'external', 'custom', null, null, 'NOTHING_TO_PAY');

  update public.table_sessions set status = 'closed', closed_at = now() where id = sid;
  perform pg_temp.expect_payment_error(sid, 1, 'external', 'custom', null, null, 'SESSION_CLOSED');

  if has_table_privilege('authenticated', 'public.payments', 'INSERT')
    or has_table_privilege('authenticated', 'public.payments', 'UPDATE')
    or has_table_privilege('authenticated', 'public.payments', 'DELETE')
    or has_function_privilege('anon',
      'public.pos_record_payment(uuid,numeric,public.payment_method,public.payment_mode,uuid,text)',
      'EXECUTE')
    or not has_function_privilege('authenticated',
      'public.pos_record_payment(uuid,numeric,public.payment_method,public.payment_mode,uuid,text)',
      'EXECUTE') then
    raise exception 'Payment mutation privileges are unsafe';
  end if;
  raise notice 'Payment SQL assertions passed (ledger, RPC, permissions and approved-only balance)';
end;
$$;

create function pg_temp.expect_mobile_create_error(sid uuid, request_id uuid, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin perform public.create_mobile_payment(sid,request_id);
  exception when others then actual:=sqlerrm; end;
  if actual is distinct from expected then
    raise exception 'Expected %, got %',expected,coalesce(actual,'success'); end if;
end;
$$;

do $$
declare
  diner uuid:=gen_random_uuid(); other_diner uuid:=gen_random_uuid(); peer uuid:=gen_random_uuid();
  restaurant uuid; branch uuid; table_id uuid; sid uuid; participant uuid;
  item_order uuid; first_item uuid; second_item uuid;
  request_id uuid:=gen_random_uuid(); second_request uuid:=gen_random_uuid(); peer_request uuid:=gen_random_uuid();
  fourth_request uuid:=gen_random_uuid(); peer_payment uuid;
  item_request uuid:=gen_random_uuid(); item_retry uuid:=gen_random_uuid(); final_item_request uuid:=gen_random_uuid();
  saved record; repeated record; bill record;
begin
  insert into auth.users(id,aud,role) values
    (diner,'authenticated','authenticated'),(other_diner,'authenticated','authenticated'),
    (peer,'authenticated','authenticated');
  insert into public.restaurants(name,slug) values('Mobile payment test',gen_random_uuid()::text) returning id into restaurant;
  insert into public.branches(restaurant_id,name) values(restaurant,'Mobile branch') returning id into branch;
  insert into public.tables(restaurant_id,branch_id,label) values(restaurant,branch,'Mobile table') returning id into table_id;
  insert into public.table_sessions(restaurant_id,table_id) values(restaurant,table_id) returning id into sid;
  insert into public.session_participants(session_id,user_id,display_name) values(sid,diner,'Diner') returning id into participant;
  insert into public.session_participants(session_id,user_id,display_name) values(sid,peer,'Peer');
  insert into public.orders(restaurant_id,session_id,submitted_by,total_amount,status)
    values(restaurant,sid,participant,10,'accepted');

  perform set_config('request.jwt.claim.sub',diner::text,true);
  perform pg_temp.expect_mobile_create_error(sid,request_id,'PAYMENT_METHOD_DISABLED');
  update public.branches set payment_methods='{mobile,in_person}' where id=branch;
  select * into saved from public.create_mobile_payment(sid,request_id);
  if saved.amount<>10 or saved.status<>'pending' then raise exception 'Wrong pending mobile payment'; end if;
  select * into repeated from public.create_mobile_payment(sid,request_id);
  if repeated.payment_id<>saved.payment_id then raise exception 'Mobile payment request is not idempotent'; end if;
  perform pg_temp.expect_mobile_create_error(sid,second_request,'PAYMENT_ALREADY_PENDING');
  select * into bill from public.session_bills where session_id=sid;
  if bill.paid_amount<>0 or bill.pending_amount<>10 then raise exception 'Pending mobile payment reduced balance'; end if;

  select * into repeated from public.resolve_mobile_payment(saved.payment_id,diner,'rejected');
  if repeated.status<>'rejected' then raise exception 'Sandbox rejection was not saved'; end if;
  update public.table_sessions set split_type='equal',split_equal_parts=3 where id=sid;
  select * into saved from public.create_mobile_payment(sid,second_request,'equal_split');
  if saved.amount<>3.34 then raise exception 'Wrong first equal part: %',saved.amount; end if;
  -- Otra persona puede reservar la siguiente parte antes de que se apruebe la
  -- primera; no debe volver a absorber el mismo centavo de redondeo.
  perform set_config('request.jwt.claim.sub',peer::text,true);
  select * into repeated from public.create_mobile_payment(sid,peer_request,'equal_split');
  if repeated.amount<>3.33 then raise exception 'Wrong concurrent equal part: %',repeated.amount; end if;
  peer_payment := repeated.payment_id;
  perform set_config('request.jwt.claim.sub',diner::text,true);
  begin
    perform public.resolve_mobile_payment(saved.payment_id,other_diner,'approved');
    raise exception 'Other diner resolved a payment';
  exception when others then
    if sqlerrm<>'FORBIDDEN' then raise; end if;
  end;
  select * into repeated from public.resolve_mobile_payment(saved.payment_id,diner,'approved');
  select * into bill from public.session_bills where session_id=sid;
  if repeated.status<>'approved' or bill.paid_amount<>3.34 or bill.pending_amount<>6.66 or bill.is_settled
    then raise exception 'First equal payment produced a wrong balance'; end if;
  perform public.resolve_mobile_payment(peer_payment,peer,'approved');
  select * into saved from public.create_mobile_payment(sid,fourth_request,'equal_split');
  if saved.amount<>3.33 then raise exception 'Wrong final equal part: %',saved.amount; end if;
  perform public.resolve_mobile_payment(saved.payment_id,diner,'approved');
  select * into bill from public.session_bills where session_id=sid;
  if bill.paid_amount<>10 or bill.pending_amount<>0 or not bill.is_settled
    then raise exception 'Equal payments did not settle bill'; end if;

  -- MI-42: un pago por ítems reserva exactamente las líneas elegidas. Un
  -- rechazo las libera y una aprobación impide cobrarlas nuevamente.
  insert into public.orders(restaurant_id,session_id,submitted_by,total_amount,status)
    values(restaurant,sid,participant,9,'accepted') returning id into item_order;
  insert into public.order_items(
    order_id,product_id,participant_id,is_shared,quantity,product_name,base_price,total_price
  ) values(item_order,null,participant,false,1,'Item A',4,4) returning id into first_item;
  insert into public.order_items(
    order_id,product_id,participant_id,is_shared,quantity,product_name,base_price,total_price
  ) values(item_order,null,participant,true,1,'Item B',5,5) returning id into second_item;

  select * into saved from public.create_mobile_payment(sid,item_request,'custom',array[first_item]);
  if saved.amount<>4 or not exists(
    select 1 from public.payment_order_items
    where payment_id=saved.payment_id and order_item_id=first_item and amount=4
  ) then raise exception 'Item payment did not preserve its selected line'; end if;
  select * into repeated from public.create_mobile_payment(sid,item_request,'custom',array[first_item]);
  if repeated.payment_id<>saved.payment_id then raise exception 'Item payment is not idempotent'; end if;
  begin
    perform public.create_mobile_payment(sid,item_request,'custom',array[second_item]);
    raise exception 'Reused item request accepted different items';
  exception when others then
    if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
  perform public.resolve_mobile_payment(saved.payment_id,diner,'rejected');

  select * into saved from public.create_mobile_payment(sid,item_retry,'custom',array[first_item]);
  perform public.resolve_mobile_payment(saved.payment_id,diner,'approved');
  begin
    perform public.create_mobile_payment(sid,gen_random_uuid(),'custom',array[first_item]);
    raise exception 'An approved item was charged twice';
  exception when others then
    if sqlerrm<>'PAYMENT_ITEMS_UNAVAILABLE' then raise; end if;
  end;
  select * into saved from public.create_mobile_payment(
    sid,final_item_request,'custom',array[second_item]
  );
  if saved.amount<>5 then raise exception 'Wrong second item subtotal: %',saved.amount; end if;
  perform public.resolve_mobile_payment(saved.payment_id,diner,'approved');
  select * into bill from public.session_bills where session_id=sid;
  if bill.paid_amount<>19 or bill.pending_amount<>0 or not bill.is_settled
    then raise exception 'Item payments did not settle the added order'; end if;

  update public.table_sessions set status='closed',closed_at=now() where id=sid;
  perform pg_temp.expect_mobile_create_error(sid,gen_random_uuid(),'SESSION_CLOSED');

  if has_function_privilege('anon','public.create_mobile_payment(uuid,uuid,public.payment_mode,uuid[])','EXECUTE')
    or not has_function_privilege('authenticated','public.create_mobile_payment(uuid,uuid,public.payment_mode,uuid[])','EXECUTE')
    or has_table_privilege('authenticated','public.payment_order_items','INSERT')
    or has_table_privilege('authenticated','public.payment_order_items','UPDATE')
    or has_table_privilege('authenticated','public.payment_order_items','DELETE')
    or not has_table_privilege('authenticated','public.payment_order_items','SELECT')
    or has_function_privilege('authenticated','public.resolve_mobile_payment(uuid,uuid,public.payment_status)','EXECUTE')
    then raise exception 'Unsafe mobile payment function privileges'; end if;
  raise notice 'Mobile payment SQL assertions passed (server amount, equal parts, item trace, pending, approval, rejection, idempotency)';
end;
$$;

rollback;

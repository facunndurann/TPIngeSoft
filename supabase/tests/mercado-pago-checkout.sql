-- Provider orchestration and ledger invariants. No external calls or persistent fixtures.
begin;
create function pg_temp.expect_checkout_error(statement text,expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin execute statement; exception when others then actual:=sqlerrm; end;
  if actual is distinct from expected then
    raise exception 'Expected % from %, got %',expected,statement,coalesce(actual,'success');
  end if;
end;
$$;

do $$
declare
  owner_id uuid:=gen_random_uuid(); user_a uuid:=gen_random_uuid(); user_b uuid:=gen_random_uuid();
  rid uuid; bid uuid; tid uuid; sid uuid; pa uuid; pb uuid; oid uuid; item_id uuid;
  request_a uuid:=gen_random_uuid(); request_b uuid:=gen_random_uuid();
  payment_a record; payment_b record; checkout record; recovered record; bill record;
  first_lease uuid; stamp timestamptz:=now(); token text:='APP_USR-checkout-frozen-token-123456789';
begin
  insert into auth.users(id,aud,role) values(owner_id,'authenticated','authenticated'),
    (user_a,'authenticated','authenticated'),(user_b,'authenticated','authenticated');
  insert into public.restaurants(name,slug) values('Checkout SQL',gen_random_uuid()::text) returning id into rid;
  insert into public.branches(restaurant_id,name,payment_methods) values(rid,'Centro','{mobile,in_person}') returning id into bid;
  insert into public.restaurant_members(restaurant_id,user_id,role) values(rid,owner_id,'owner');
  insert into public.branch_memberships(membership_id,restaurant_id,branch_id)
    select m.id,rid,bid from public.restaurant_members m where m.restaurant_id=rid and m.user_id=owner_id;
  insert into public.profiles(id,username_normalized,full_name) values(owner_id,replace(owner_id::text,'-',''),'Owner');
  insert into public.tables(restaurant_id,branch_id,label) values(rid,bid,'Mesa') returning id into tid;
  insert into public.table_sessions(restaurant_id,table_id,split_type,split_equal_parts)
    values(rid,tid,'equal',2) returning id into sid;
  insert into public.session_participants(session_id,user_id,display_name) values(sid,user_a,'A') returning id into pa;
  insert into public.session_participants(session_id,user_id,display_name) values(sid,user_b,'B') returning id into pb;
  insert into public.orders(restaurant_id,session_id,submitted_by,total_amount,status)
    values(rid,sid,pa,100,'accepted') returning id into oid;
  insert into public.order_items(order_id,participant_id,quantity,product_name,base_price,total_price)
    values(oid,pa,1,'Meal',100,100) returning id into item_id;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.save_payment_provider_config(rid,'test',array[bid],token,'checkout-webhook-frozen-secret-123');

  perform set_config('request.jwt.claim.sub',user_a::text,true);
  select * into payment_a from public.create_mobile_payment(sid,request_a,'equal_split');
  if payment_a.amount<>50 then raise exception 'Equal split amount changed'; end if;
  perform pg_temp.expect_checkout_error(format('update public.orders set total_amount=80 where id=%L',oid),'PAYMENT_COMMITTED_ORDER');
  perform pg_temp.expect_checkout_error(format('update public.order_items set total_price=80 where id=%L',item_id),'PAYMENT_COMMITTED_ORDER');
  -- A full payment only reserves the remaining balance, across every split mode.
  perform set_config('request.jwt.claim.sub',user_b::text,true);
  select * into payment_b from public.create_mobile_payment(sid,request_b,'full');
  if payment_b.amount<>50 then raise exception 'Full payment ignored another reservation'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform pg_temp.expect_checkout_error(format('select public.pos_record_payment(%L,1,''in_person'')',sid),'PAYMENT_ALREADY_PENDING');

  select * into checkout from public.claim_mobile_checkout(payment_a.payment_id,user_a);
  if checkout.checkout_state<>'creating' or checkout.external_reference<>payment_a.payment_id::text
    or checkout.access_token<>token or checkout.amount<>50 or checkout.currency_id<>'ARS' then
    raise exception 'Invalid leased provider context'; end if;
  first_lease:=checkout.lease_token;
  perform pg_temp.expect_checkout_error(format('select public.claim_mobile_checkout(%L,%L)',payment_a.payment_id,user_a),'CHECKOUT_IN_PROGRESS');
  perform pg_temp.expect_checkout_error(format('select public.claim_mobile_checkout(%L,%L)',payment_a.payment_id,user_b),'FORBIDDEN');
  perform pg_temp.expect_checkout_error(format('update public.orders set total_amount=80 where id=%L',oid),'PAYMENT_COMMITTED_ORDER');
  -- Expired leases are uncertain, never permission to POST a duplicate preference.
  update private.mobile_checkouts set lease_expires_at=now()-interval '1 minute' where payment_id=payment_a.payment_id;
  select * into recovered from public.claim_mobile_checkout(payment_a.payment_id,user_a);
  if recovered.checkout_state<>'uncertain' or recovered.lease_token<>first_lease then raise exception 'Unsafe lease recovery'; end if;
  perform public.complete_mobile_checkout(payment_a.payment_id,first_lease,'preference-test-a',
    'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=preference-test-a','12345');
  select * into recovered from public.claim_mobile_checkout(payment_a.payment_id,user_a);
  if recovered.checkout_state<>'ready' or recovered.preference_id<>'preference-test-a' or recovered.collector_id<>'12345'
    then raise exception 'Ready preference was not reused'; end if;
  perform pg_temp.expect_checkout_error(format('select public.complete_mobile_checkout(%L,%L,''other'',''https://www.mercadopago.com.ar/'',''12345'')',
    payment_a.payment_id,gen_random_uuid()),'CHECKOUT_LEASE_MISMATCH');

  -- Current configuration rotation, branch disabling, removal, and account closure
  -- cannot change the credentials of an already issued checkout.
  perform public.save_payment_provider_config(rid,'production','{}','APP_USR-new-rotated-token-123456789','rotated-webhook-secret-123456789');
  perform public.delete_payment_provider_config(rid);
  update public.table_sessions set status='closed',closed_at=now() where id=sid;
  select * into recovered from public.resolve_payment_provider_for_payment(payment_a.payment_id,null);
  if recovered.access_token<>token or recovered.environment<>'test'
    or recovered.webhook_secret<>'checkout-webhook-frozen-secret-123' then raise exception 'Credential snapshot was lost'; end if;
  perform set_config('request.jwt.claim.sub',user_a::text,true);
  select * into recovered from public.create_mobile_payment(sid,request_a,'equal_split');
  if recovered.payment_id<>payment_a.payment_id then raise exception 'Replay after closure lost original payment'; end if;

  perform pg_temp.expect_checkout_error(format('select public.apply_mercado_pago_payment(%L,''81001'',%L,49,''ARS'',''approved'',%L)',
    payment_a.payment_id,payment_a.payment_id::text,stamp),'PAYMENT_PROVIDER_MISMATCH');
  perform pg_temp.expect_checkout_error(format('select public.apply_mercado_pago_payment(%L,''81001'',%L,50,''USD'',''approved'',%L)',
    payment_a.payment_id,payment_a.payment_id::text,stamp),'PAYMENT_PROVIDER_MISMATCH');
  perform pg_temp.expect_checkout_error(format('select public.apply_mercado_pago_payment(%L,''81001'',''spoofed'',50,''ARS'',''approved'',%L)',
    payment_a.payment_id,stamp),'PAYMENT_PROVIDER_MISMATCH');
  perform public.apply_mercado_pago_payment(payment_a.payment_id,'81001',payment_a.payment_id::text,50,'ARS','approved',stamp);
  if (select status from public.payments where id=payment_a.payment_id)<>'approved'
    or (select reconciliation_issue from public.payments where id=payment_a.payment_id)<>'APPROVED_AFTER_SESSION_CLOSED'
    then raise exception 'A real collection after closure was lost'; end if;
  perform public.apply_mercado_pago_payment(payment_a.payment_id,'81001',payment_a.payment_id::text,50,'ARS','approved',stamp);
  perform public.apply_mercado_pago_payment(payment_a.payment_id,'81001',payment_a.payment_id::text,50,'ARS','pending',stamp-interval '1 minute');
  if (select count(*) from private.mobile_payment_events where payment_id=payment_a.payment_id)<>2
    or (select status from public.payments where id=payment_a.payment_id)<>'approved' then raise exception 'Duplicate/stale event changed the ledger'; end if;

  perform public.apply_mercado_pago_payment(payment_a.payment_id,'81001',payment_a.payment_id::text,50,'ARS','approved',stamp+interval '1 minute',10);
  select * into bill from public.session_bills where session_id=sid;
  if bill.paid_amount<>40 or bill.pending_amount<>60 then raise exception 'Partial refund not reflected in the ledger'; end if;
  perform public.apply_mercado_pago_payment(payment_a.payment_id,'81001',payment_a.payment_id::text,50,'ARS','refunded',stamp+interval '2 minutes',50);
  select * into bill from public.session_bills where session_id=sid;
  if bill.paid_amount<>0 or bill.pending_amount<>100 then raise exception 'Full refund not reflected in the ledger'; end if;
  perform public.apply_mercado_pago_payment(payment_a.payment_id,'81001',payment_a.payment_id::text,50,'ARS','approved',stamp+interval '3 minutes',0);
  if (select status from public.payments where id=payment_a.payment_id)<>'cancelled' then raise exception 'Refund was incorrectly reversed'; end if;

  perform pg_temp.expect_checkout_error(format('select public.apply_mercado_pago_payment(%L,''81001'',%L,50,''ARS'',''approved'',%L)',
    payment_b.payment_id,payment_b.payment_id::text,stamp),'PAYMENT_PROVIDER_MISMATCH');

  -- Checkout Pro may retry a rejected payment with a different provider payment ID.
  perform public.apply_mercado_pago_payment(payment_b.payment_id,'81002',payment_b.payment_id::text,50,'ARS','rejected',stamp);
  perform public.apply_mercado_pago_payment(payment_b.payment_id,'81003',payment_b.payment_id::text,50,'ARS','approved',stamp+interval '1 minute');
  if (select mp_payment_id from public.payments where id=payment_b.payment_id)<>'81003' then raise exception 'New approved provider attempt was ignored'; end if;
  perform public.apply_mercado_pago_payment(payment_b.payment_id,'81004',payment_b.payment_id::text,50,'ARS','approved',stamp+interval '2 minutes');
  if (select reconciliation_issue from public.payments where id=payment_b.payment_id)<>'MULTIPLE_PROVIDER_PAYMENTS'
    or (select mp_payment_id from public.payments where id=payment_b.payment_id)<>'81003' then raise exception 'Duplicate collection was overwritten'; end if;
  perform public.apply_mercado_pago_payment(payment_b.payment_id,'81003',payment_b.payment_id::text,50,'ARS','charged_back',stamp+interval '3 minutes');
  if (select status from public.payments where id=payment_b.payment_id)<>'cancelled'
    or (select provider_status from public.payments where id=payment_b.payment_id)<>'charged_back' then raise exception 'Chargeback was lost'; end if;

  for i in 1..20 loop perform public.consume_payment_rate_limit(user_a,'status'); end loop;
  perform pg_temp.expect_checkout_error(format('select public.consume_payment_rate_limit(%L,''status'')',user_a),'PAYMENT_RATE_LIMITED');
  if has_function_privilege('authenticated','public.claim_mobile_checkout(uuid,uuid)','execute')
    or has_function_privilege('anon','public.resolve_payment_provider_for_payment(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.apply_mercado_pago_payment(uuid,text,text,numeric,text,text,timestamptz,numeric)','execute')
    or has_table_privilege('authenticated','private.mobile_checkouts','select') then raise exception 'Provider controls exposed to client'; end if;
  raise notice 'Checkout SQL assertions passed: reservations, leases, frozen credentials, matching, idempotency, refunds, chargebacks, rate limits';
end;
$$;
rollback;

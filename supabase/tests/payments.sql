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

rollback;

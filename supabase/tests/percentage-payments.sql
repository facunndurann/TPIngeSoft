-- MI-43: la división por porcentaje/ratio, cerrada contra pagos reales.
--
-- Lo que se prueba acá es que el importe lo decide Postgres: el celular manda
-- el modo, nunca el monto. Y que el porcentaje se aplica al total de la cuenta,
-- no al pendiente, que encoge cuando otro paga.
-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.expect_percentage_error(sid uuid, request_id uuid, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin perform public.create_mobile_payment(sid, request_id, 'percentage_split');
  exception when others then actual := sqlerrm; end;
  if actual is distinct from expected then
    raise exception 'Expected %, got %', expected, coalesce(actual, 'success'); end if;
end;
$$;

do $$
declare
  ana uuid := gen_random_uuid();
  beto uuid := gen_random_uuid();
  caro uuid := gen_random_uuid();
  restaurant uuid; branch uuid; table_id uuid; sid uuid;
  ana_id uuid; beto_id uuid; caro_id uuid;
  paid record; bill record;
  shares numeric;
begin
  insert into auth.users(id,aud,role) values
    (ana,'authenticated','authenticated'),(beto,'authenticated','authenticated'),
    (caro,'authenticated','authenticated');
  insert into public.restaurants(name,slug) values('Percentage test',gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.branches(restaurant_id,name,payment_methods)
    values(restaurant,'Centro','{mobile}') returning id into branch;
  insert into public.tables(restaurant_id,branch_id,label) values(restaurant,branch,'Mesa 1')
    returning id into table_id;
  insert into public.table_sessions(restaurant_id,table_id) values(restaurant,table_id)
    returning id into sid;
  insert into public.session_participants(session_id,user_id,display_name)
    values(sid,ana,'Ana') returning id into ana_id;
  insert into public.session_participants(session_id,user_id,display_name)
    values(sid,beto,'Beto') returning id into beto_id;
  insert into public.session_participants(session_id,user_id,display_name)
    values(sid,caro,'Caro') returning id into caro_id;
  -- Un total que no se divide en tres: obliga a repartir el centavo sobrante.
  insert into public.orders(restaurant_id,session_id,submitted_by,total_amount,status)
    values(restaurant,sid,ana_id,100.01,'accepted');

  -- ---------- Sin división por porcentajes no hay parte ----------
  if public.session_percentage_share(sid,ana_id) is not null then
    raise exception 'A session without percentages must not have shares'; end if;
  perform set_config('request.jwt.claim.sub',ana::text,true);
  perform pg_temp.expect_percentage_error(sid,gen_random_uuid(),'INVALID_SPLIT');

  update public.table_sessions set split_type='percentages', split_allocations=jsonb_build_object(
    ana_id::text,33.33, beto_id::text,33.33, caro_id::text,33.34) where id=sid;

  -- ---------- El reparto cierra exacto ----------
  select public.session_percentage_share(sid,ana_id) + public.session_percentage_share(sid,beto_id)
    + public.session_percentage_share(sid,caro_id) into shares;
  if shares <> 100.01 then raise exception 'Shares do not add up to the bill: %', shares; end if;
  -- El centavo sobrante va a la fracción más alta (33.34% de 100.01 = 33.3434).
  if public.session_percentage_share(sid,ana_id) <> 33.33
    or public.session_percentage_share(sid,beto_id) <> 33.33
    or public.session_percentage_share(sid,caro_id) <> 33.35 then
    raise exception 'Wrong largest-remainder distribution'; end if;
  -- Un comensal que se sumó después no tiene asignación y no puede pagar así.
  if public.session_percentage_share(sid,gen_random_uuid()) is not null then
    raise exception 'A diner without allocation must not have a share'; end if;

  -- ---------- El importe lo decide el servidor ----------
  select * into paid from public.create_mobile_payment(sid,gen_random_uuid(),'percentage_split');
  -- Ni el total (100.01) ni el pendiente dividido por comensales: su porcentaje.
  if paid.amount <> 33.33 or paid.status <> 'pending' then
    raise exception 'Wrong percentage payment amount: %', paid.amount; end if;
  if (select mode from public.payments where id=paid.payment_id) <> 'percentage_split' then
    raise exception 'The payment does not record how it was calculated'; end if;

  select * into bill from public.session_bills where session_id=sid;
  if bill.pending_amount <> 100.01 then
    raise exception 'A pending payment must not reduce the balance'; end if;
  perform public.resolve_mobile_payment(paid.payment_id,ana,'approved');
  select * into bill from public.session_bills where session_id=sid;
  if bill.paid_amount <> 33.33 or bill.pending_amount <> 66.68 then
    raise exception 'Approved percentage payment left a wrong balance: %', to_jsonb(bill); end if;

  -- Su parte ya está cubierta: el pendiente de la mesa es de los demás.
  perform pg_temp.expect_percentage_error(sid,gen_random_uuid(),'NOTHING_TO_PAY');

  -- ---------- Las tres partes saldan la cuenta ----------
  perform set_config('request.jwt.claim.sub',beto::text,true);
  select * into paid from public.create_mobile_payment(sid,gen_random_uuid(),'percentage_split');
  if paid.amount <> 33.33 then raise exception 'Wrong second share: %', paid.amount; end if;
  perform public.resolve_mobile_payment(paid.payment_id,beto,'approved');

  perform set_config('request.jwt.claim.sub',caro::text,true);
  select * into paid from public.create_mobile_payment(sid,gen_random_uuid(),'percentage_split');
  if paid.amount <> 33.35 then raise exception 'Wrong third share: %', paid.amount; end if;
  perform public.resolve_mobile_payment(paid.payment_id,caro,'approved');

  select * into bill from public.session_bills where session_id=sid;
  if bill.pending_amount <> 0 or not bill.is_settled then
    raise exception 'The three shares did not settle the bill: %', to_jsonb(bill); end if;
end;
$$;

-- Lo que ya pagó la mesa por otra vía acota la parte que se cobra: el
-- porcentaje nunca puede pedir más de lo que se debe.
do $$
declare
  uno uuid := gen_random_uuid(); dos uuid := gen_random_uuid();
  restaurant uuid; branch uuid; table_id uuid; sid uuid; uno_id uuid; dos_id uuid;
  paid record;
begin
  insert into auth.users(id,aud,role) values
    (uno,'authenticated','authenticated'),(dos,'authenticated','authenticated');
  insert into public.restaurants(name,slug) values('Percentage cap',gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.branches(restaurant_id,name,payment_methods)
    values(restaurant,'Centro','{mobile,external}') returning id into branch;
  insert into public.tables(restaurant_id,branch_id,label) values(restaurant,branch,'Mesa 1')
    returning id into table_id;
  insert into public.table_sessions(restaurant_id,table_id) values(restaurant,table_id)
    returning id into sid;
  insert into public.session_participants(session_id,user_id,display_name)
    values(sid,uno,'Uno') returning id into uno_id;
  insert into public.session_participants(session_id,user_id,display_name)
    values(sid,dos,'Dos') returning id into dos_id;
  insert into public.orders(restaurant_id,session_id,submitted_by,total_amount,status)
    values(restaurant,sid,uno_id,100,'accepted');
  update public.table_sessions set split_type='percentages',
    split_allocations=jsonb_build_object(uno_id::text,40,dos_id::text,60) where id=sid;

  -- El otro comensal pagó casi todo en efectivo antes de que Uno abriera la app.
  insert into public.payments(restaurant_id,session_id,participant_id,amount,mode,method,status)
    values(restaurant,sid,dos_id,90,'full','external','approved');

  perform set_config('request.jwt.claim.sub',uno::text,true);
  select * into paid from public.create_mobile_payment(sid,gen_random_uuid(),'percentage_split');
  if paid.amount <> 10 then
    raise exception 'The share must be capped by the outstanding balance: %', paid.amount; end if;

  raise notice 'Percentage payment SQL assertions passed (share over the total, largest remainder, server amount, balance cap, settlement)';
end;
$$;

rollback;

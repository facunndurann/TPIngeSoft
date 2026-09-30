-- Sprint 3, fase 3 / MI-40: configuración privada de Mercado Pago, asociación
-- por sucursal, aislamiento y disponibilidad efectiva. Reversible e independiente del seed.
begin;

create function pg_temp.expect_error(statement text, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin execute statement;
  exception when others then actual := sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'Expected % from %, got %', expected, statement, coalesce(actual, 'success');
  end if;
end;
$$;

do $$
declare
  owner_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  waiter_id uuid := gen_random_uuid();
  diner_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  rid uuid;
  other_rid uuid;
  bid uuid;
  second_bid uuid;
  other_bid uuid;
  dining_table uuid;
  sid uuid;
  participant uuid;
  payment record;
  repeated record;
  config jsonb;
  receiver record;
  access_secret uuid;
  webhook_secret uuid;
  request_id uuid := gen_random_uuid();
  token text := 'APP_USR-phase-three-secret-token';
  webhook text := 'phase-three-webhook-secret';
begin
  insert into auth.users(id,aud,role) values
    (owner_id,'authenticated','authenticated'),
    (manager_id,'authenticated','authenticated'),
    (waiter_id,'authenticated','authenticated'),
    (diner_id,'authenticated','authenticated'),
    (outsider_id,'authenticated','authenticated');
  insert into public.restaurants(name,slug)
    values('Provider config',gen_random_uuid()::text) returning id into rid;
  insert into public.restaurants(name,slug)
    values('Other provider config',gen_random_uuid()::text) returning id into other_rid;
  insert into public.branches(restaurant_id,name,payment_methods)
    values(rid,'Centro','{mobile,in_person}') returning id into bid;
  insert into public.branches(restaurant_id,name,payment_methods)
    values(rid,'Norte','{mobile}') returning id into second_bid;
  insert into public.branches(restaurant_id,name,payment_methods)
    values(other_rid,'Ajena','{mobile}') returning id into other_bid;
  insert into public.restaurant_members(restaurant_id,user_id,role) values
    (rid,owner_id,'owner'),
    (rid,manager_id,'manager'),
    (rid,waiter_id,'waiter'),
    (other_rid,outsider_id,'owner');
  insert into public.profiles(id,username_normalized,full_name) values
    (waiter_id,replace(waiter_id::text,'-',''),'Mozo');
  insert into public.branch_memberships(membership_id,restaurant_id,branch_id)
    select m.id,rid,bid from public.restaurant_members m
    where m.restaurant_id=rid and m.user_id=waiter_id;
  insert into public.tables(restaurant_id,branch_id,label)
    values(rid,bid,'Mesa') returning id into dining_table;
  insert into public.table_sessions(restaurant_id,table_id)
    values(rid,dining_table) returning id into sid;
  insert into public.session_participants(session_id,user_id,display_name)
    values(sid,diner_id,'Diner') returning id into participant;
  insert into public.orders(restaurant_id,session_id,submitted_by,total_amount,status)
    values(rid,sid,participant,25,'accepted');

  -- Medio prendido sin cuenta receptora: customer ve solo "no disponible" y
  -- el servidor tampoco admite crear el intento.
  perform set_config('request.jwt.claim.sub',diner_id::text,true);
  if public.mobile_payment_available(sid) then
    raise exception 'Mobile payment available without provider configuration'; end if;
  perform pg_temp.expect_error(format(
    'select public.create_mobile_payment(%L,%L)',sid,request_id),
    'PAYMENT_METHOD_DISABLED');

  -- Un rol operativo y el dueño de otro restaurante no administran la cuenta.
  perform set_config('request.jwt.claim.sub',waiter_id::text,true);
  perform pg_temp.expect_error(format(
    'select public.save_payment_provider_config(%L,''test'',array[%L]::uuid[],%L,%L)',
    rid,bid,token,webhook),'FORBIDDEN');
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  perform pg_temp.expect_error(format(
    'select * from public.get_payment_provider_config(%L)',rid),'FORBIDDEN');

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  -- No se puede asociar una sucursal ajena.
  perform pg_temp.expect_error(format(
    'select public.save_payment_provider_config(%L,''test'',array[%L]::uuid[],%L,%L)',
    rid,other_bid,token,webhook),'INVALID_REQUEST');

  perform public.save_payment_provider_config(
    rid,'test',array[bid],token,webhook
  );
  select to_jsonb(c) into config
    from public.get_payment_provider_config(rid) c;
  if config->>'configured' <> 'true'
    or config->>'environment' <> 'test'
    or config->>'access_token_hint' <> right(token,4)
    or config->>'webhook_configured' <> 'true'
    or config->'branch_ids' <> jsonb_build_array(bid)
    or config::text like '%' || token || '%'
    or config::text like '%' || webhook || '%' then
    raise exception 'Unsafe or wrong masked config: %',config; end if;

  select c.access_token_secret_id,c.webhook_secret_id
    into access_secret,webhook_secret
    from private.payment_provider_credentials c
    where c.restaurant_id=rid and c.provider='mercado_pago';
  if (select s.secret=token from vault.secrets s where s.id=access_secret)
    or (select s.secret=webhook from vault.secrets s where s.id=webhook_secret) then
    raise exception 'Provider secrets were stored in plaintext'; end if;

  -- Manager también es administrador y puede conservar los secretos al cambiar
  -- solamente las asociaciones.
  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  perform public.save_payment_provider_config(
    rid,'test',array[bid,second_bid],null,null
  );

  perform set_config('request.jwt.claim.sub',diner_id::text,true);
  update public.branches set payment_methods='{in_person}' where id=bid;
  if public.mobile_payment_available(sid) then
    raise exception 'Provider bypassed the branch payment method'; end if;
  perform pg_temp.expect_error(format(
    'select public.create_mobile_payment(%L,%L)',sid,request_id),
    'PAYMENT_METHOD_DISABLED');
  update public.branches set payment_methods='{mobile,in_person}' where id=bid;
  if not public.mobile_payment_available(sid) then
    raise exception 'Configured branch is not available to its participant'; end if;
  select * into payment from public.create_mobile_payment(sid,request_id);
  if payment.amount <> 25 or payment.status <> 'pending' then
    raise exception 'Unexpected configured payment: %',to_jsonb(payment); end if;

  -- Quitar la asociación bloquea intentos nuevos, pero el ya iniciado se puede
  -- recuperar y resolver: no se corta el callback al deshabilitar.
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.save_payment_provider_config(rid,'test','{}',null,null);
  perform set_config('request.jwt.claim.sub',diner_id::text,true);
  if public.mobile_payment_available(sid) then
    raise exception 'Unassociated branch stayed available'; end if;
  select * into repeated from public.create_mobile_payment(sid,request_id);
  if repeated.payment_id <> payment.payment_id then
    raise exception 'Existing attempt was not recoverable after disabling provider'; end if;
  select * into repeated
    from public.resolve_mobile_payment(payment.payment_id,diner_id,'rejected');
  if repeated.status <> 'rejected' then
    raise exception 'Existing payment could not be resolved after disabling'; end if;
  perform pg_temp.expect_error(format(
    'select public.create_mobile_payment(%L,%L)',sid,gen_random_uuid()),
    'PAYMENT_METHOD_DISABLED');

  -- Solo service_role tiene el contrato que devuelve secretos descifrados.
  if has_function_privilege('authenticated',
      'public.resolve_payment_provider_for_session(uuid)','EXECUTE')
    or not has_function_privilege('service_role',
      'public.resolve_payment_provider_for_session(uuid)','EXECUTE') then
    raise exception 'Provider resolver privileges are unsafe'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.save_payment_provider_config(rid,'test',array[bid],null,null);
  select * into receiver from public.resolve_payment_provider_for_session(sid);
  if receiver.access_token <> token or receiver.webhook_secret <> webhook
    or receiver.restaurant_id <> rid or receiver.branch_id <> bid then
    raise exception 'Backend receiver resolution is wrong'; end if;

  -- Otro comensal autenticado no consulta ni opera la cuenta.
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  perform pg_temp.expect_error(format(
    'select public.mobile_payment_available(%L)',sid),'NOT_PARTICIPANT');

  -- Desvincular borra asociación, metadatos privados y secretos de Vault.
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.delete_payment_provider_config(rid);
  if exists(select 1 from private.payment_provider_credentials c where c.restaurant_id=rid)
    or exists(select 1 from vault.secrets s where s.id in(access_secret,webhook_secret)) then
    raise exception 'Deleting config left credentials behind'; end if;

  raise notice 'Payment provider SQL assertions passed (Vault, admin scope, branch availability, backend-only secrets, disable/recovery)';
end;
$$;

rollback;

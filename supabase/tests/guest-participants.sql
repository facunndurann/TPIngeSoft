-- Invitados: add_guest_participant suma a la cuenta a alguien sin QR y le pasa
-- sus ítems en una sola transacción. Todos los rechazos usan códigos del
-- catálogo compartido (packages/shared/src/errors.ts).
-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.expect_guest_error(
  sid uuid, guest_name text, expected text
) returns void language plpgsql as $$
declare actual text;
begin
  begin
    perform public.add_guest_participant(sid, guest_name);
  exception when others then actual := sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'Expected %, got %', expected, coalesce(actual, 'success');
  end if;
end;
$$;

do $$
declare
  ana uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  restaurant uuid;
  branch uuid;
  dining_table uuid;
  sid uuid;
  closed_sid uuid;
  ana_participant uuid;
  own_order uuid;
  foreign_order uuid;
  own_item uuid;
  kept_item uuid;
  foreign_item uuid;
  guest uuid;
  saved public.session_participants;
begin
  insert into auth.users(id, aud, role) values
    (ana,'authenticated','authenticated'), (outsider,'authenticated','authenticated');
  insert into public.restaurants(name, slug) values('Guest test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.branches(restaurant_id, name) values(restaurant,'Centro') returning id into branch;
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch,'Mesa 1')
    returning id into dining_table;

  insert into public.table_sessions(restaurant_id, table_id) values(restaurant, dining_table)
    returning id into sid;
  insert into public.table_sessions(restaurant_id, table_id, status, closed_at)
    values(restaurant, dining_table,'closed', now()) returning id into closed_sid;
  insert into public.session_participants(session_id, user_id, display_name)
    values(sid, ana,'Ana') returning id into ana_participant;

  insert into public.orders(restaurant_id, session_id, submitted_by, total_amount, status)
    values(restaurant, sid, ana_participant, 9, 'accepted') returning id into own_order;
  insert into public.order_items(
    order_id, product_id, participant_id, is_shared, quantity, product_name, base_price, total_price
  ) values(own_order, null, ana_participant, false, 1, 'Pizza', 4, 4) returning id into own_item;
  insert into public.order_items(
    order_id, product_id, participant_id, is_shared, quantity, product_name, base_price, total_price
  ) values(own_order, null, ana_participant, false, 1, 'Flan', 5, 5) returning id into kept_item;
  -- Ítem de OTRA sesión: su id no puede terminar a nombre del invitado.
  insert into public.orders(restaurant_id, session_id, total_amount, status)
    values(restaurant, closed_sid, 3, 'accepted') returning id into foreign_order;
  insert into public.order_items(
    order_id, product_id, participant_id, is_shared, quantity, product_name, base_price, total_price
  ) values(foreign_order, null, null, false, 1, 'Café', 3, 3) returning id into foreign_item;

  -- ---------- Sesión, permisos y nombre ----------
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_guest_error(sid, 'Carla', 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_guest_error(sid, 'Carla', 'NOT_PARTICIPANT');
  perform set_config('request.jwt.claim.sub', ana::text, true);
  perform pg_temp.expect_guest_error(gen_random_uuid(), 'Carla', 'SESSION_NOT_FOUND');
  perform pg_temp.expect_guest_error(closed_sid, 'Carla', 'SESSION_CLOSED');
  -- El mismo límite que participantNameSchema: de 1 a 40 caracteres sin espacios de más.
  perform pg_temp.expect_guest_error(sid, '   ', 'INVALID_NAME');
  perform pg_temp.expect_guest_error(sid, null, 'INVALID_NAME');
  perform pg_temp.expect_guest_error(sid, repeat('a', 41), 'INVALID_NAME');

  if (select count(*) from public.session_participants where session_id = sid) <> 1 then
    raise exception 'Rejected calls should not leave a guest behind'; end if;

  -- ---------- Alta con reasignación ----------
  guest := public.add_guest_participant(sid, '  Carla  ', array[own_item, foreign_item]);
  select * into saved from public.session_participants where id = guest;
  if saved.session_id <> sid or saved.user_id is not null or saved.display_name <> 'Carla' then
    raise exception 'The guest should join this session, without account and with a trimmed name'; end if;
  if (select participant_id from public.order_items where id = own_item) <> guest then
    raise exception 'The chosen item should move to the guest'; end if;
  if (select participant_id from public.order_items where id = kept_item) <> ana_participant then
    raise exception 'Items that were not chosen should keep their owner'; end if;
  if (select participant_id from public.order_items where id = foreign_item) is not null then
    raise exception 'Items from another session should never move'; end if;

  -- Sin ítems también es un alta válida: alguien que solo va a pagar su parte.
  if public.add_guest_participant(sid, 'Dani') is null then
    raise exception 'A guest without items should still be created'; end if;

  -- ---------- Una sola puerta ----------
  if to_regprocedure('public.reassign_order_items(uuid[],uuid)') is not null
     or to_regprocedure('public.add_guest_participant(uuid,text)') is not null then
    raise exception 'The old two-step RPCs should be gone'; end if;
  if has_function_privilege('anon', 'public.add_guest_participant(uuid,text,uuid[])', 'execute') then
    raise exception 'Anonymous callers should not add guests'; end if;

  raise notice 'Guest SQL assertions passed (auth, membership, open session, name limit, atomic reassignment, single entry point)';
end;
$$;

rollback;

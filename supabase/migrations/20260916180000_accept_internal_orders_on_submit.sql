-- submit_order acepta el pedido en la misma transacción cuando el POS es interno.
--
-- Antes, la función submit-order hacía 7 viajes a la base (getUser, submit_order,
-- loadOrder, get_order_pos_type, dispatch_internal_order y dos loadOrder más) y
-- crear y aceptar eran dos transacciones: si la segunda fallaba, el pedido quedaba
-- "enviado, por confirmar" y un reintento tenía que completar el despacho. Ahora
-- submit_order crea y acepta juntos y devuelve la fila del pedido. Si el POS no
-- puede recibirlo, no queda nada guardado.
--
-- El estado 'submitted' queda para pedidos anteriores a este cambio y para los POS
-- externos que se integren a futuro: el personal los acepta desde el tablero
-- (transition_order → dispatch_internal_order).

-- submit_order resuelve el POS adentro: nadie necesita consultar su tipo por separado.
drop function public.get_order_pos_type(uuid);

-- Solo la usan submit_order y transition_order (security definer): nadie la
-- invoca directamente.
revoke execute on function public.dispatch_internal_order(uuid) from authenticated;
comment on function public.dispatch_internal_order(uuid) is
  'Internal, idempotent POS acceptance used by submit_order and transition_order. Errors: AUTH_REQUIRED, ORDER_NOT_FOUND, FORBIDDEN, POS_UNAVAILABLE, POS_UNSUPPORTED.';

-- Cambia el tipo de retorno (uuid → orders), así que la función se recrea.
drop function public.submit_order(uuid, uuid, jsonb, numeric, text);

create function public.submit_order(
  p_session_id uuid,
  p_request_id uuid,
  p_items jsonb,
  p_expected_total numeric,
  p_notes text default null
)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  target_session public.table_sessions;
  participant uuid;
  previous_order public.orders;
  request_body jsonb;
  menu_snapshot jsonb;
  item jsonb;
  product jsonb;
  modifier_group jsonb;
  modifier_option jsonb;
  option_ids uuid[];
  removed_ids uuid[];
  group_count integer;
  selected_count integer;
  quantity integer;
  unit_price numeric;
  line_total numeric;
  order_total numeric := 0;
  order_id uuid;
  saved_order public.orders;
  item_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_request_id is null or p_expected_total is null
    or p_expected_total::text in ('NaN', 'Infinity', '-Infinity')
    or p_expected_total < 0 or p_expected_total > 99999999.99
    or p_expected_total <> round(p_expected_total, 2)
    or length(p_notes) > 500 then
    raise exception 'INVALID_REQUEST';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ITEMS';
  end if;
  if jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'INVALID_ITEMS';
  end if;
  -- Validate shape before any casts. RPC callers receive the same protection
  -- as callers of the Edge Function (which performs an earlier Zod check).
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object' then raise exception 'INVALID_ITEMS'; end if;
    if not item ?& array['productId', 'quantity', 'optionIds', 'removedIds', 'isShared']
      or exists (select 1 from jsonb_object_keys(item) k where k <> all(
        array['productId', 'quantity', 'optionIds', 'removedIds', 'isShared']))
      or jsonb_typeof(item->'productId') <> 'string'
      or (item->>'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'quantity') <> 'number'
      or jsonb_typeof(item->'optionIds') <> 'array'
      or jsonb_typeof(item->'removedIds') <> 'array'
      or jsonb_typeof(item->'isShared') <> 'boolean' then
      raise exception 'INVALID_ITEMS';
    end if;
    if (item->>'quantity')::numeric not between 1 and 99
      or trunc((item->>'quantity')::numeric) <> (item->>'quantity')::numeric
      or jsonb_array_length(item->'optionIds') > 100
      or jsonb_array_length(item->'removedIds') > 100 then
      raise exception 'INVALID_ITEMS';
    end if;
    if exists (
      select 1 from jsonb_array_elements((item->'optionIds') || (item->'removedIds')) v
      where jsonb_typeof(v) <> 'string'
        or (v #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then raise exception 'INVALID_ITEMS'; end if;
    -- Cast before DISTINCT so UUID case cannot evade duplicate detection.
    if (select count(*) <> count(distinct value::uuid)
        from jsonb_array_elements_text(item->'optionIds'))
      or (select count(*) <> count(distinct value::uuid)
        from jsonb_array_elements_text(item->'removedIds')) then
      raise exception 'INVALID_ITEMS';
    end if;
  end loop;

  -- Use the same table-before-session lock order as join_table_session.
  perform 1 from public.tables t
    join public.table_sessions s on s.table_id = t.id
    where s.id = p_session_id for share of t;
  -- Serialize confirmation with session closure and other table submissions.
  select * into target_session from public.table_sessions
    where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  select id into participant from public.session_participants
    where session_id = p_session_id and user_id = auth.uid();
  if participant is null then raise exception 'NOT_PARTICIPANT'; end if;
  request_body := jsonb_build_object(
    'sessionId', p_session_id, 'items', p_items,
    'expectedTotal', p_expected_total, 'notes', p_notes
  );
  select * into previous_order from public.orders
    where submitted_by = participant and request_id = p_request_id;
  if found then
    if previous_order.request_payload is distinct from request_body then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    -- A successful request can be recovered after closure or menu changes.
    return previous_order;
  end if;
  if target_session.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;
  perform 1 from public.tables t
    join public.branches b on b.id = t.branch_id
    where t.id = target_session.table_id and t.is_active and b.is_active;
  if not found then raise exception 'TABLE_UNAVAILABLE'; end if;

  -- One SQL statement captures the entire relevant menu at one MVCC snapshot.
  -- All validation, names and prices below use that same captured version.
  -- Solo entran productos del restaurante de la sesión (un id ajeno queda afuera y
  -- se rechaza como PRODUCT_UNAVAILABLE). Por las FKs compuestas, sus categorías,
  -- ingredientes, grupos y opciones son del mismo restaurante.
  select coalesce(jsonb_object_agg(p.id, to_jsonb(p) || jsonb_build_object(
    'category', to_jsonb(c),
    'ingredients', coalesce((select jsonb_agg(to_jsonb(i))
      from public.product_ingredients i where i.product_id = p.id), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object(
      'options', coalesce((select jsonb_agg(to_jsonb(o))
        from public.modifier_options o where o.group_id = g.id), '[]'::jsonb)
    )) from public.product_modifier_groups pg
      join public.modifier_groups g on g.id = pg.group_id
      where pg.product_id = p.id), '[]'::jsonb)
  )), '{}'::jsonb) into menu_snapshot
  from public.products p
  join public.menu_categories c on c.id = p.category_id
  where p.restaurant_id = target_session.restaurant_id
    and p.id in (select (value->>'productId')::uuid from jsonb_array_elements(p_items));

  insert into public.orders(restaurant_id, session_id, submitted_by, request_id, request_payload, notes)
    values(target_session.restaurant_id, p_session_id, participant, p_request_id, request_body, p_notes)
    returning id into order_id;

  for item in select value from jsonb_array_elements(p_items) loop
    product := menu_snapshot->((item->>'productId')::uuid::text);
    if product is null
      or not (product->>'is_available')::boolean
      or not (product->'category'->>'is_active')::boolean then
      raise exception 'PRODUCT_UNAVAILABLE';
    end if;
    quantity := (item->>'quantity')::numeric::integer;
    option_ids := array(select value::uuid from jsonb_array_elements_text(item->'optionIds'));
    removed_ids := array(select value::uuid from jsonb_array_elements_text(item->'removedIds'));
    unit_price := (product->>'base_price')::numeric;

    if (select count(*) from jsonb_array_elements(product->'ingredients') i
        where (i->>'id')::uuid = any(removed_ids)
          and (i->>'is_removable')::boolean) <> cardinality(removed_ids) then
      raise exception 'INVALID_INGREDIENTS';
    end if;
    -- Un ingrediente agotado solo se tolera si es removible y el comensal lo quitó.
    if exists (
      select 1 from jsonb_array_elements(product->'ingredients') i
      where not (i->>'is_available')::boolean
        and not ((i->>'is_removable')::boolean and (i->>'id')::uuid = any(removed_ids))
    ) then
      raise exception 'PRODUCT_UNAVAILABLE';
    end if;

    selected_count := 0;
    for modifier_group in select value from jsonb_array_elements(product->'groups') loop
      group_count := 0;
      for modifier_option in select value from jsonb_array_elements(modifier_group->'options') loop
        if (modifier_option->>'id')::uuid = any(option_ids) then
          if not (modifier_option->>'is_available')::boolean then
            raise exception 'INVALID_MODIFIERS';
          end if;
          group_count := group_count + 1;
          unit_price := unit_price + (modifier_option->>'price_delta')::numeric;
        end if;
      end loop;
      if group_count < (modifier_group->>'min_select')::integer
        or group_count > (modifier_group->>'max_select')::integer
        or (not (modifier_group->>'is_available')::boolean
          and (group_count > 0 or (modifier_group->>'min_select')::integer > 0)) then
        raise exception 'INVALID_MODIFIERS';
      end if;
      selected_count := selected_count + group_count;
    end loop;
    if selected_count <> cardinality(option_ids) then raise exception 'INVALID_MODIFIERS'; end if;
    line_total := unit_price * quantity;
    if unit_price < 0 or line_total > 99999999.99 then raise exception 'INVALID_ITEMS'; end if;
    order_total := order_total + line_total;
    if order_total > 99999999.99 then raise exception 'INVALID_ITEMS'; end if;

    insert into public.order_items(order_id, product_id, participant_id, is_shared,
      quantity, product_name, base_price, total_price)
    values(order_id, (product->>'id')::uuid, participant, (item->>'isShared')::boolean,
      quantity, product->>'name', (product->>'base_price')::numeric, line_total)
    returning id into item_id;
    insert into public.order_item_removed_ingredients(order_item_id, ingredient_id, ingredient_name)
      select item_id, (i->>'id')::uuid, i->>'name'
      from jsonb_array_elements(product->'ingredients') i
      where (i->>'id')::uuid = any(removed_ids);
    insert into public.order_item_modifiers(order_item_id, group_id, option_id,
      group_name, option_name, price_delta)
      select item_id, (g->>'id')::uuid, (o->>'id')::uuid,
        g->>'name', o->>'name', (o->>'price_delta')::numeric
      from jsonb_array_elements(product->'groups') g
      cross join lateral jsonb_array_elements(g->'options') o
      where (o->>'id')::uuid = any(option_ids);
  end loop;
  if order_total <> p_expected_total then raise exception 'PRICE_CHANGED'; end if;
  update public.orders set total_amount = order_total where id = order_id;
  insert into public.integration_logs(restaurant_id, order_id, event, payload)
    values(target_session.restaurant_id, order_id, 'order.submitted',
      jsonb_build_object('requestId', p_request_id, 'totalAmount', order_total));

  -- Recepción del POS interno en esta misma transacción. Si el POS no puede
  -- recibirlo (POS_UNAVAILABLE, POS_UNSUPPORTED) se revierte el pedido completo
  -- y el mismo envío se puede reintentar más tarde.
  perform public.dispatch_internal_order(order_id);

  select * into saved_order from public.orders where id = order_id;
  return saved_order;
end;
$$;

revoke all on function public.submit_order(uuid, uuid, jsonb, numeric, text) from public, anon;
grant execute on function public.submit_order(uuid, uuid, jsonb, numeric, text) to authenticated;

comment on function public.submit_order(uuid, uuid, jsonb, numeric, text) is
  'Atomic order snapshot and internal POS acceptance; returns the saved order. Errors: AUTH_REQUIRED, INVALID_REQUEST, INVALID_ITEMS, SESSION_NOT_FOUND, NOT_PARTICIPANT, SESSION_CLOSED, TABLE_UNAVAILABLE, PRODUCT_UNAVAILABLE, INVALID_INGREDIENTS, INVALID_MODIFIERS, PRICE_CHANGED, IDEMPOTENCY_CONFLICT, REQUEST_ABANDONED, POS_UNAVAILABLE, POS_UNSUPPORTED.';

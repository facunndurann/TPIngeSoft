-- Phase 4: authenticated, atomic order submission and authoritative snapshots.
-- Public RPC error messages are stable codes consumed by submit-order.
alter table public.orders
  add column request_id uuid,
  add column request_payload jsonb,
  add constraint orders_participant_request_unique unique (submitted_by, request_id);

-- Members use transition_order; browsers cannot modify prices or snapshots.
drop policy "members update orders" on public.orders;
revoke insert, update, delete on public.orders, public.order_items,
  public.order_item_modifiers, public.order_item_removed_ingredients,
  public.integration_logs, public.payments from anon, authenticated;

-- Check both identifiers, including historical rows created before this RPC.
drop policy "participants and members read orders" on public.orders;
create policy "participants and members read orders" on public.orders
  for select to authenticated using (exists (
    select 1 from public.table_sessions s
    where s.id = orders.session_id and s.restaurant_id = orders.restaurant_id
      and (public.is_session_participant(s.id) or public.is_restaurant_member(s.restaurant_id))
  ));
drop policy "participants and members read payments" on public.payments;
create policy "participants and members read payments" on public.payments
  for select to authenticated using (exists (
    select 1 from public.table_sessions s
    where s.id = payments.session_id and s.restaurant_id = payments.restaurant_id
      and (public.is_session_participant(s.id) or public.is_restaurant_member(s.restaurant_id))
  ));

create or replace function public.submit_order(
  p_session_id uuid,
  p_request_id uuid,
  p_items jsonb,
  p_expected_total numeric,
  p_notes text default null
)
returns uuid
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
  ingredient jsonb;
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
    return previous_order.id;
  end if;
  if target_session.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;
  perform 1 from public.tables t
    join public.branches b on b.id = t.branch_id and b.restaurant_id = t.restaurant_id
    join public.restaurants r on r.id = t.restaurant_id
    where t.id = target_session.table_id and t.restaurant_id = target_session.restaurant_id
      and t.is_active and b.is_active;
  if not found then raise exception 'TABLE_UNAVAILABLE'; end if;

  -- One SQL statement captures the entire relevant menu at one MVCC snapshot.
  -- All validation, names and prices below use that same captured version.
  select coalesce(jsonb_object_agg(p.id, to_jsonb(p) || jsonb_build_object(
    'category', to_jsonb(c),
    'ingredients', coalesce((select jsonb_agg(to_jsonb(i))
      from public.product_ingredients i where i.product_id = p.id), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object(
      'assignment_restaurant_id', pg.restaurant_id,
      'options', coalesce((select jsonb_agg(to_jsonb(o))
        from public.modifier_options o where o.group_id = g.id), '[]'::jsonb)
    )) from public.product_modifier_groups pg
      join public.modifier_groups g on g.id = pg.group_id
      where pg.product_id = p.id), '[]'::jsonb)
  )), '{}'::jsonb) into menu_snapshot
  from public.products p left join public.menu_categories c on c.id = p.category_id
  where p.id in (select (value->>'productId')::uuid from jsonb_array_elements(p_items));

  insert into public.orders(restaurant_id, session_id, submitted_by, request_id, request_payload, notes)
    values(target_session.restaurant_id, p_session_id, participant, p_request_id, request_body, p_notes)
    returning id into order_id;

  for item in select value from jsonb_array_elements(p_items) loop
    product := menu_snapshot->((item->>'productId')::uuid::text);
    if product is null
      or (product->>'restaurant_id')::uuid <> target_session.restaurant_id
      or (product->'category'->>'restaurant_id')::uuid is distinct from target_session.restaurant_id
      or not (product->>'is_available')::boolean
      or not coalesce((product->'category'->>'is_active')::boolean, false) then
      raise exception 'PRODUCT_UNAVAILABLE';
    end if;
    quantity := (item->>'quantity')::numeric::integer;
    option_ids := array(select value::uuid from jsonb_array_elements_text(item->'optionIds'));
    removed_ids := array(select value::uuid from jsonb_array_elements_text(item->'removedIds'));
    unit_price := (product->>'base_price')::numeric;

    if (select count(*) from jsonb_array_elements(product->'ingredients') i
        where (i->>'id')::uuid = any(removed_ids)
          and (i->>'restaurant_id')::uuid = target_session.restaurant_id
          and (i->>'is_removable')::boolean) <> cardinality(removed_ids) then
      raise exception 'INVALID_INGREDIENTS';
    end if;
    for ingredient in select value from jsonb_array_elements(product->'ingredients') loop
      if (ingredient->>'restaurant_id')::uuid <> target_session.restaurant_id
        or (not (ingredient->>'is_available')::boolean
          and not ((ingredient->>'is_removable')::boolean
            and (ingredient->>'id')::uuid = any(removed_ids))) then
        raise exception 'PRODUCT_UNAVAILABLE';
      end if;
    end loop;

    selected_count := 0;
    for modifier_group in select value from jsonb_array_elements(product->'groups') loop
      if (modifier_group->>'restaurant_id')::uuid <> target_session.restaurant_id
        or (modifier_group->>'assignment_restaurant_id')::uuid <> target_session.restaurant_id then
        raise exception 'INVALID_MODIFIERS';
      end if;
      group_count := 0;
      for modifier_option in select value from jsonb_array_elements(modifier_group->'options') loop
        if (modifier_option->>'id')::uuid = any(option_ids) then
          if (modifier_option->>'restaurant_id')::uuid <> target_session.restaurant_id
            or not (modifier_option->>'is_available')::boolean then
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
  return order_id;
end;
$$;

create or replace function public.dispatch_internal_order(p_order_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.orders;
  integration public.pos_integrations;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select o.* into target from public.orders o
    join public.table_sessions s on s.id = o.session_id and s.restaurant_id = o.restaurant_id
    where o.id = p_order_id for update of o;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if not public.is_restaurant_member(target.restaurant_id) and not exists (
    select 1 from public.session_participants p
    where p.id = target.submitted_by and p.session_id = target.session_id and p.user_id = auth.uid()
  ) then raise exception 'FORBIDDEN'; end if;
  -- Retries after acceptance (including later terminal states) do no work.
  if target.status <> 'submitted' then return target.id; end if;
  select * into integration from public.pos_integrations
    where restaurant_id = target.restaurant_id for share;
  if found then
    if not integration.is_active then raise exception 'POS_UNAVAILABLE'; end if;
    if integration.type <> 'internal' then raise exception 'POS_UNSUPPORTED'; end if;
  end if;
  update public.orders set status = 'accepted', accepted_at = now() where id = target.id;
  insert into public.integration_logs(restaurant_id, order_id, event, payload)
    values(target.restaurant_id, target.id, 'pos.internal.accepted',
      jsonb_build_object('from', target.status, 'to', 'accepted', 'actorId', auth.uid()));
  return target.id;
end;
$$;

-- Expose only the adapter type, never external credentials, to the caller.
create or replace function public.get_order_pos_type(p_order_id uuid)
returns public.pos_type
language plpgsql security definer set search_path = public
as $$
declare
  target public.orders;
  integration public.pos_integrations;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select o.* into target from public.orders o
    join public.table_sessions s on s.id = o.session_id and s.restaurant_id = o.restaurant_id
    where o.id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if not public.is_restaurant_member(target.restaurant_id) and not exists (
    select 1 from public.session_participants p
    where p.id = target.submitted_by and p.session_id = target.session_id and p.user_id = auth.uid()
  ) then raise exception 'FORBIDDEN'; end if;
  select * into integration from public.pos_integrations where restaurant_id = target.restaurant_id;
  if not found then return 'internal'; end if;
  if not integration.is_active then raise exception 'POS_UNAVAILABLE'; end if;
  return integration.type;
end;
$$;

create or replace function public.transition_order(p_order_id uuid, p_status public.order_status)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.orders;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select o.* into target from public.orders o
    join public.table_sessions s on s.id = o.session_id and s.restaurant_id = o.restaurant_id
    where o.id = p_order_id for update of o;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if not public.is_restaurant_member(target.restaurant_id) then raise exception 'FORBIDDEN'; end if;
  if p_status is null then raise exception 'INVALID_TRANSITION'; end if;
  if target.status = p_status then return target.id; end if;
  if target.status = 'submitted' and p_status = 'accepted' then
    return public.dispatch_internal_order(target.id);
  end if;
  if not (
    (target.status = 'accepted' and p_status = 'in_preparation')
    or (target.status = 'in_preparation' and p_status = 'ready')
    or (target.status = 'ready' and p_status = 'delivered')
    or (target.status in ('submitted', 'accepted', 'in_preparation', 'ready') and p_status = 'cancelled')
  ) then raise exception 'INVALID_TRANSITION'; end if;
  update public.orders set status = p_status,
    preparing_at = case when p_status = 'in_preparation' then now() else preparing_at end,
    ready_at = case when p_status = 'ready' then now() else ready_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
  where id = target.id;
  insert into public.integration_logs(restaurant_id, order_id, event, payload)
    values(target.restaurant_id, target.id, 'order.status_changed',
      jsonb_build_object('from', target.status, 'to', p_status, 'actorId', auth.uid()));
  return target.id;
end;
$$;

revoke all on function public.submit_order(uuid, uuid, jsonb, numeric, text) from public, anon;
revoke all on function public.dispatch_internal_order(uuid) from public, anon;
revoke all on function public.get_order_pos_type(uuid) from public, anon;
revoke all on function public.transition_order(uuid, public.order_status) from public, anon;
grant execute on function public.submit_order(uuid, uuid, jsonb, numeric, text) to authenticated;
grant execute on function public.dispatch_internal_order(uuid) to authenticated;
grant execute on function public.get_order_pos_type(uuid) to authenticated;
grant execute on function public.transition_order(uuid, public.order_status) to authenticated;

-- Each aggregate is independent, avoiding multiplication of payments by items.
-- security_invoker ensures underlying session/order/payment RLS still applies.
create view public.session_bills with (security_invoker = true) as
select s.id as session_id, s.restaurant_id,
  coalesce(o.submitted_amount, 0::numeric) as submitted_amount,
  coalesce(o.total_amount, 0::numeric) as total_amount,
  coalesce(p.paid_amount, 0::numeric) as paid_amount,
  greatest(coalesce(o.total_amount, 0::numeric) - coalesce(p.paid_amount, 0::numeric), 0::numeric) as pending_amount,
  (coalesce(o.submitted_count, 0) = 0 and coalesce(o.total_amount, 0::numeric) > 0
    and coalesce(p.paid_amount, 0::numeric) >= coalesce(o.total_amount, 0::numeric)) as is_settled
from public.table_sessions s
left join lateral (
  select sum(total_amount) filter (where status = 'submitted') as submitted_amount,
    count(*) filter (where status = 'submitted') as submitted_count,
    sum(total_amount) filter (where status in ('accepted', 'in_preparation', 'ready', 'delivered')) as total_amount
  from public.orders where session_id = s.id and restaurant_id = s.restaurant_id
) o on true
left join lateral (
  select sum(amount) as paid_amount from public.payments
  where session_id = s.id and restaurant_id = s.restaurant_id and status = 'approved'
) p on true;
revoke all on public.session_bills from public, anon;
grant select on public.session_bills to authenticated;

comment on function public.submit_order(uuid, uuid, jsonb, numeric, text) is
  'Atomic order snapshot. Errors: AUTH_REQUIRED, INVALID_REQUEST, INVALID_ITEMS, SESSION_NOT_FOUND, NOT_PARTICIPANT, SESSION_CLOSED, TABLE_UNAVAILABLE, PRODUCT_UNAVAILABLE, INVALID_INGREDIENTS, INVALID_MODIFIERS, PRICE_CHANGED, IDEMPOTENCY_CONFLICT.';
comment on function public.dispatch_internal_order(uuid) is
  'Idempotent POS acceptance. Errors: AUTH_REQUIRED, ORDER_NOT_FOUND, FORBIDDEN, POS_UNAVAILABLE, POS_UNSUPPORTED.';
comment on function public.transition_order(uuid, public.order_status) is
  'Tenant members only; forward transitions or cancellation before delivery. Errors: AUTH_REQUIRED, ORDER_NOT_FOUND, FORBIDDEN, INVALID_TRANSITION, POS_UNAVAILABLE, POS_UNSUPPORTED.';

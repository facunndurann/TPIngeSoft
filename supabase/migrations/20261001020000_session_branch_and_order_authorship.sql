-- ============================================================
-- Sprint 3, fase 2: la cuenta deja de depender de la mesa y el pedido guarda
-- quién lo creó (contratos C1 y C2 de docs/sprint3-progress.md).
--
-- Cuenta. table_sessions sigue siendo la identidad de la cuenta. Ahora sabe su
-- sucursal (branch_id) y su tipo (kind): 'table' cuelga de una mesa, 'takeout'
-- es una compra para llevar sin mesa. Antes la sucursal se deducía siempre por
-- tables, así que una cuenta sin mesa no tenía permisos, medios de pago ni
-- lugar en el tablero. No hay "mesa mostrador": una compra no es una mesa.
--
-- Autoría. origin dice por qué canal entró el pedido ('qr' o 'pos'). El autor
-- QR sigue siendo submitted_by (un participante); el autor POS es una cuenta de
-- personal, con copia de su nombre. assigned_user_id no sirve de autor: lo pisa
-- cada apertura, transición, atención o traslado de la mesa.
--
-- Los pedidos existentes quedan como 'qr': submit_order fue la única vía de
-- escritura (los navegadores no tienen INSERT en orders). Si su participante ya
-- no existe, el autor queda desconocido (submitted_by nulo), como antes.
-- ============================================================

create type public.session_kind as enum ('table', 'takeout');
create type public.order_origin as enum ('qr', 'pos');

-- ------------------------------------------------------------
-- Cuenta: sucursal explícita y tipo
-- ------------------------------------------------------------

alter table public.table_sessions
  add column kind public.session_kind not null default 'table',
  add column branch_id uuid;

update public.table_sessions s set branch_id = t.branch_id
  from public.tables t
  where t.id = s.table_id and t.restaurant_id = s.restaurant_id;

alter table public.table_sessions
  alter column branch_id set not null,
  alter column table_id drop not null;

-- La mesa de una cuenta es de su mismo restaurante y su misma sucursal. Lo
-- impone la base, no cada función: pos_move_table_session ya rechaza cambiar de
-- sucursal y ahora además no puede dejar la cuenta en otra sucursal que su mesa.
-- La FK de la mesa se reemplaza (mismo nombre) en vez de sumar otra: con dos FKs
-- entre table_sessions y tables, PostgREST no sabría cuál usar en un embed
-- `tables(...)` y fallaría cada consulta que hoy lo usa sin hint. Con table_id
-- nulo (takeout) la FK no se evalúa.
alter table public.tables
  add constraint tables_restaurant_branch_id_key unique (restaurant_id, branch_id, id);

alter table public.table_sessions
  drop constraint table_sessions_table_id_fkey,
  add constraint table_sessions_table_id_fkey
    foreign key (restaurant_id, branch_id, table_id)
    references public.tables(restaurant_id, branch_id, id) on delete cascade,
  add constraint table_sessions_branch_fkey
    foreign key (restaurant_id, branch_id) references public.branches(restaurant_id, id),
  add constraint table_sessions_kind_matches_table
    check ((kind = 'table') = (table_id is not null));

create index table_sessions_branch_status_idx on public.table_sessions(branch_id, status);

-- Una cuenta de mesa solo puede estar en la sucursal de su mesa, así que quien
-- la crea sin decir la sucursal (join_table_session, pos_open_table_session y
-- los fixtures de las pruebas) la recibe de la mesa. Una cuenta sin mesa tiene
-- que traerla: si no, el not null la rechaza.
create function public.fill_session_branch()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.branch_id is null and new.table_id is not null then
    select branch_id into new.branch_id from public.tables
      where id = new.table_id and restaurant_id = new.restaurant_id;
  end if;
  return new;
end;
$$;

create trigger table_sessions_fill_branch
  before insert on public.table_sessions
  for each row execute function public.fill_session_branch();

comment on column public.table_sessions.kind is
  'table = cuenta de una mesa (table_id obligatorio); takeout = compra para llevar, sin mesa.';
comment on column public.table_sessions.branch_id is
  'Sucursal de la cuenta. Decide permisos, medios de pago y tablero. En una cuenta de mesa es la de su mesa y se completa sola al insertar.';

-- ------------------------------------------------------------
-- Pedido: origen y autor
-- ------------------------------------------------------------

alter table public.orders
  add column origin public.order_origin not null default 'qr',
  add column staff_author_id uuid references public.profiles(id) on delete set null,
  add column staff_author_name text,
  -- Un pedido QR no tiene autor de personal. Uno POS no tiene participante:
  -- el id de una cuenta de personal nunca va en la FK de participantes. Su
  -- nombre se copia porque la cuenta puede borrarse (staff_author_id pasa a nulo).
  -- El `is not null` explícito importa: un check que da null se acepta.
  add constraint orders_author_matches_origin check (case origin
    when 'qr' then staff_author_id is null and staff_author_name is null
    when 'pos' then submitted_by is null and staff_author_name is not null
      and length(btrim(staff_author_name)) between 1 and 100
  end);

-- Idempotencia por actor y solicitud. QR ya la tiene con
-- orders_participant_request_unique (submitted_by, request_id); POS la tiene
-- por cuenta de personal. Mismo requestId con el mismo contenido devuelve el
-- pedido; con otro contenido, IDEMPOTENCY_CONFLICT.
create unique index orders_staff_request_unique
  on public.orders(staff_author_id, request_id) where origin = 'pos';

-- Nada reescribe la autoría: ni mover la mesa, ni cerrar la cuenta, ni cambiar
-- el responsable. Solo se pierde la referencia cuando se borra el participante
-- o la cuenta de personal (on delete set null), y el nombre copiado queda.
create function public.keep_order_authorship()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.origin is distinct from old.origin
    or new.staff_author_name is distinct from old.staff_author_name
    or (new.submitted_by is distinct from old.submitted_by and new.submitted_by is not null)
    or (new.staff_author_id is distinct from old.staff_author_id and new.staff_author_id is not null)
  then
    raise exception 'ORDER_AUTHORSHIP_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger orders_keep_authorship
  before update on public.orders
  for each row execute function public.keep_order_authorship();

comment on column public.orders.origin is
  'Canal por el que entró el pedido: qr (comensal) o pos (personal). No cambia.';
comment on column public.orders.staff_author_id is
  'Cuenta de personal que cargó un pedido POS. Nulo en pedidos QR o si la cuenta se borró.';
comment on column public.orders.staff_author_name is
  'Nombre de quien cargó un pedido POS, copiado al crearlo.';

-- ------------------------------------------------------------
-- Sucursal desde la cuenta, no desde la mesa
-- ------------------------------------------------------------

create or replace function public.can_read_session(sid uuid, permission_name text default 'orders.read')
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from table_sessions s
    where s.id = sid and (
      (public.is_restaurant_admin(s.restaurant_id) and not exists(select 1 from profiles where id=auth.uid())) or
      public.has_permission(s.restaurant_id, permission_name, s.branch_id)
    ));
$$;

create or replace function public.submit_order(
  p_session_id uuid,
  p_request_id uuid,
  p_items jsonb,
  p_expected_total numeric,
  p_notes text default null
)
returns public.orders
language plpgsql security definer set search_path = public
as $_$
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
  -- Una cuenta sin mesa no tiene mesa que bloquear.
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
  -- La sucursal de la cuenta tiene que estar activa, y si la cuenta es de una
  -- mesa, también la mesa.
  perform 1 from public.branches b
    where b.id = target_session.branch_id and b.is_active
      and (target_session.table_id is null or exists (
        select 1 from public.tables t
        where t.id = target_session.table_id and t.is_active));
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

  insert into public.orders(restaurant_id, session_id, origin, submitted_by, request_id, request_payload, notes)
    values(target_session.restaurant_id, p_session_id, 'qr', participant, p_request_id, request_body, p_notes)
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
$_$;

create or replace function public.create_mobile_payment(
  p_session_id uuid,
  p_request_id uuid,
  p_mode public.payment_mode default 'full',
  p_item_ids uuid[] default null
)
returns table(payment_id uuid, amount numeric, status public.payment_status)
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  diner_id uuid;
  methods public.payment_method[];
  due numeric;
  available_due numeric;
  payment_amount numeric;
  allocated_equal_parts integer;
  reserved_equal_amount numeric;
  remaining_parts integer;
  requested_count integer;
  saved_count integer;
  percentage_share numeric;
  settled_by_diner numeric;
  saved public.payments;
  reference text := 'mobile-request:' || p_request_id::text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_request_id is null or p_mode is null
    or p_mode not in ('full','equal_split','percentage_split','custom')
    then raise exception 'INVALID_REQUEST'; end if;
  if p_mode = 'custom' and (
    coalesce(cardinality(p_item_ids),0)=0 or cardinality(p_item_ids)>100
  )
    then raise exception 'INVALID_PAYMENT_ITEMS'; end if;
  if p_mode <> 'custom' and p_item_ids is not null
    then raise exception 'INVALID_PAYMENT_ITEMS'; end if;
  if exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'FORBIDDEN'; end if;

  select * into target from public.table_sessions where id=p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;
  select id into diner_id from public.session_participants
    where session_id=target.id and user_id=auth.uid();
  if diner_id is null then raise exception 'NOT_PARTICIPANT'; end if;
  select b.payment_methods into methods from public.branches b
    where b.id=target.branch_id and b.restaurant_id=target.restaurant_id;
  if not ('mobile'=any(methods)) then raise exception 'PAYMENT_METHOD_DISABLED'; end if;

  select * into saved from public.payments
    where restaurant_id=target.restaurant_id and method='mobile'
      and external_reference=reference;
  if found then
    if saved.session_id <> target.id or saved.participant_id <> diner_id or saved.mode <> p_mode
      then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if p_mode='custom' then
      select count(*) into saved_count from public.payment_order_items poi
        where poi.payment_id=saved.id;
      if saved_count <> cardinality(p_item_ids) or exists (
        select 1 from unnest(p_item_ids) requested(id)
        where not exists (
          select 1 from public.payment_order_items poi
          where poi.payment_id=saved.id and poi.order_item_id=requested.id
        )
      ) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    end if;
    return query select saved.id,saved.amount,saved.status; return;
  end if;
  if exists(select 1 from public.payments p where p.session_id=target.id
    and p.participant_id=diner_id and p.method='mobile' and p.status='pending')
    then raise exception 'PAYMENT_ALREADY_PENDING'; end if;

  select greatest(
    coalesce((select sum(o.total_amount) from public.orders o where o.session_id=target.id
      and o.restaurant_id=target.restaurant_id
      and o.status in ('accepted','in_preparation','ready','delivered')),0)
    - coalesce((select sum(p.amount) from public.payments p where p.session_id=target.id
      and p.restaurant_id=target.restaurant_id and p.status='approved'),0), 0
  ) into due;
  if due=0 then raise exception 'NOTHING_TO_PAY'; end if;

  if p_mode = 'equal_split' then
    if target.split_type <> 'equal' or target.split_equal_parts is null
      then raise exception 'INVALID_SPLIT'; end if;
    select count(*), coalesce(sum(p.amount) filter (where p.status='pending'),0)
      into allocated_equal_parts, reserved_equal_amount
      from public.payments p
      where p.session_id=target.id and p.restaurant_id=target.restaurant_id
        and p.mode='equal_split' and p.status in ('pending','approved');
    available_due := greatest(due - reserved_equal_amount, 0);
    if available_due=0 then raise exception 'PAYMENT_ALREADY_PENDING'; end if;
    remaining_parts := greatest(target.split_equal_parts - allocated_equal_parts, 1);
    payment_amount := ceil(available_due * 100 / remaining_parts) / 100;
  elsif p_mode = 'percentage_split' then
    if target.split_type <> 'percentages' then raise exception 'INVALID_SPLIT'; end if;
    percentage_share := public.session_percentage_share(target.id, diner_id);
    -- Sin asignación, o con 0%, no hay nada que este comensal deba pagar por
    -- porcentaje: la división es lo que hay que revisar, no el saldo.
    if coalesce(percentage_share, 0) <= 0 then raise exception 'INVALID_SPLIT'; end if;
    select coalesce(sum(p.amount),0) into settled_by_diner
      from public.payments p
      where p.session_id=target.id and p.restaurant_id=target.restaurant_id
        and p.participant_id=diner_id and p.status='approved';
    -- Lo que le falta de su parte, nunca más que lo que la mesa todavía debe:
    -- si otro pagó de más, el porcentaje no lo vuelve a cobrar.
    payment_amount := least(greatest(percentage_share - settled_by_diner, 0), due);
    if payment_amount <= 0 then raise exception 'NOTHING_TO_PAY'; end if;
  elsif p_mode = 'custom' then
    select count(*), coalesce(sum(oi.total_price),0)
      into requested_count, payment_amount
    from unnest(p_item_ids) requested(id)
    join public.order_items oi on oi.id=requested.id
    join public.orders o on o.id=oi.order_id
    where o.session_id=target.id and o.restaurant_id=target.restaurant_id
      and o.status in ('accepted','in_preparation','ready','delivered')
      and oi.total_price>0;
    if requested_count <> cardinality(p_item_ids)
      or requested_count <> (select count(distinct id) from unnest(p_item_ids) chosen(id))
      then raise exception 'INVALID_PAYMENT_ITEMS'; end if;
    if exists (
      select 1 from public.payment_order_items poi
      join public.payments p on p.id=poi.payment_id
      where poi.order_item_id=any(p_item_ids) and p.status in ('pending','approved')
    ) then raise exception 'PAYMENT_ITEMS_UNAVAILABLE'; end if;
    if payment_amount > due then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
  else
    payment_amount := due;
  end if;

  insert into public.payments(
    restaurant_id,session_id,participant_id,amount,mode,method,status,external_reference
  ) values(
    target.restaurant_id,target.id,diner_id,payment_amount,p_mode,'mobile','pending',reference
  ) returning * into saved;

  if p_mode='custom' then
    insert into public.payment_order_items(payment_id,order_item_id,amount)
    select saved.id,oi.id,oi.total_price
    from public.order_items oi where oi.id=any(p_item_ids);
  end if;
  return query select saved.id,saved.amount,saved.status;
end;
$$;

create or replace function public.pos_record_payment(
  p_session_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_mode public.payment_mode default 'full',
  p_participant_id uuid default null,
  p_external_reference text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  target_branch uuid;
  enabled_methods public.payment_method[];
  account_total numeric := 0;
  approved_total numeric := 0;
  pending_total numeric := 0;
  payment_id uuid;
  normalized_reference text := nullif(btrim(p_external_reference), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_amount is null or p_method is null or p_mode is null
    then raise exception 'INVALID_REQUEST'; end if;
  if p_amount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    or p_amount <= 0 or p_amount <> round(p_amount, 2)
    then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;
  if normalized_reference is not null and length(normalized_reference) > 200
    then raise exception 'INVALID_REQUEST'; end if;

  -- Todas las registraciones de la sesión toman el mismo lock. Dos cajas no
  -- pueden acreditar simultáneamente más que el saldo disponible.
  select * into target from public.table_sessions
  where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;

  target_branch := target.branch_id;
  select b.payment_methods into enabled_methods
  from public.branches b
  where b.id = target.branch_id and b.restaurant_id = target.restaurant_id;
  if not exists(select 1 from public.profiles where id = auth.uid())
    or not public.has_permission(target.restaurant_id, 'payments.write', target_branch)
    then raise exception 'FORBIDDEN'; end if;
  if not (p_method = any(enabled_methods)) then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  -- El pago mobile sólo se confirma desde la integración de la fase 10. El POS
  -- no puede fabricar una aprobación que el proveedor nunca confirmó.
  if p_method = 'mobile' then raise exception 'PAYMENT_METHOD_UNAVAILABLE'; end if;

  if p_participant_id is not null and not exists(
    select 1 from public.session_participants
    where id = p_participant_id and session_id = target.id
  ) then raise exception 'INVALID_PARTICIPANT'; end if;

  select coalesce(sum(total_amount), 0) into account_total
  from public.orders
  where session_id = target.id and restaurant_id = target.restaurant_id
    and status in ('accepted','in_preparation','ready','delivered');
  select coalesce(sum(amount), 0) into approved_total
  from public.payments
  where session_id = target.id and restaurant_id = target.restaurant_id
    and status = 'approved';
  pending_total := greatest(account_total - approved_total, 0);
  if pending_total = 0 then raise exception 'NOTHING_TO_PAY'; end if;
  if p_amount > pending_total then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;

  begin
    insert into public.payments(
      restaurant_id, session_id, participant_id, amount, mode, method,
      status, external_reference
    ) values (
      target.restaurant_id, target.id, p_participant_id, p_amount, p_mode,
      p_method, 'approved', normalized_reference
    ) returning id into payment_id;
  exception when unique_violation then
    raise exception 'PAYMENT_REFERENCE_CONFLICT';
  end;

  perform public.record_pos_action(
    target.restaurant_id, target_branch, 'payment.recorded', null, target.id,
    jsonb_build_object(
      'paymentId', payment_id,
      'amount', p_amount,
      'method', p_method,
      'mode', p_mode,
      'participantId', p_participant_id
    )
  );
  return payment_id;
end;
$$;

create or replace function public.pos_transition_order(p_order_id uuid, p_status public.order_status)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare target public.orders; bid uuid; needed text; integration public.pos_integrations; reverting boolean;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Filter authorization before returning existence/state information or locking.
  select o.* into target from orders o where o.id=p_order_id
    and public.can_read_session(o.session_id) for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  select s.branch_id into bid from table_sessions s
    where s.id=target.session_id and s.restaurant_id=target.restaurant_id;
  needed := case
    when p_status='cancelled' then 'orders.cancel'
    when p_status < target.status then 'orders.revert'
    when p_status='accepted' then 'orders.accept'
    when p_status in ('in_preparation','ready') then 'orders.prepare'
    when p_status='delivered' then 'orders.deliver'
    else null end;
  if needed is null or bid is null or not exists(select 1 from profiles where id=auth.uid())
    or not public.has_permission(target.restaurant_id,needed,bid) then raise exception 'FORBIDDEN'; end if;
  if target.status=p_status then return target.id; end if;
  if (target.status,p_status) not in (values
    ('submitted'::public.order_status,'accepted'::public.order_status),
    ('accepted','in_preparation'),('in_preparation','ready'),('ready','delivered'),
    ('in_preparation','accepted'),('ready','in_preparation'),('delivered','ready'),
    ('submitted','cancelled'),('accepted','cancelled'),('in_preparation','cancelled'),('ready','cancelled')
  ) then raise exception 'INVALID_TRANSITION'; end if;
  if p_status='accepted' and target.status='submitted' then
    select * into integration from pos_integrations where restaurant_id=target.restaurant_id for share;
    if found then
      if not integration.is_active then raise exception 'POS_UNAVAILABLE'; end if;
      if integration.type <> 'internal' then raise exception 'POS_UNSUPPORTED'; end if;
    end if;
  end if;
  reverting := p_status < target.status;
  update orders set status=p_status,
    accepted_at=case when p_status='accepted' and not reverting then now() else accepted_at end,
    preparing_at=case when reverting and p_status<'in_preparation' then null
      when not reverting and p_status='in_preparation' then now() else preparing_at end,
    ready_at=case when reverting and p_status<'ready' then null
      when not reverting and p_status='ready' then now() else ready_at end,
    delivered_at=case when reverting then null when p_status='delivered' then now() else delivered_at end,
    cancelled_at=case when p_status='cancelled' then now() else cancelled_at end where id=target.id;
  update table_sessions set assigned_user_id=auth.uid() where id=target.session_id;
  perform public.record_pos_action(target.restaurant_id,bid,'order.transition',target.id,target.session_id,
    jsonb_build_object('from',target.status,'to',p_status));
  insert into integration_logs(restaurant_id,order_id,event,payload)
    values(target.restaurant_id,target.id,'order.status_changed',
      jsonb_build_object('from',target.status,'to',p_status,'actorId',auth.uid()));
  return target.id;
end;
$$;

create or replace function public.pos_close_table_session(p_session_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare target public.table_sessions; bid uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from profiles where id=auth.uid()) or
    not public.can_read_session(p_session_id,'sessions.close') then raise exception 'FORBIDDEN'; end if;
  -- Same table/session lock order as join/submit. Una cuenta sin mesa solo bloquea la sesión.
  perform 1 from tables t join table_sessions s on s.table_id=t.id where s.id=p_session_id for update of t;
  select * into target from table_sessions where id=p_session_id for update;
  bid := target.branch_id;
  if bid is null or not public.has_permission(target.restaurant_id,'sessions.close',bid) then raise exception 'FORBIDDEN'; end if;
  if target.status='closed' then return target.id; end if;
  update table_sessions set status='closed',closed_at=now() where id=target.id;
  perform public.record_pos_action(target.restaurant_id,bid,'session.closed',null,target.id);
  insert into integration_logs(restaurant_id,event,payload)
    values(target.restaurant_id,'session.closed',jsonb_build_object('sessionId',target.id,'actorId',auth.uid()));
  return target.id;
end;
$$;

create or replace function public.pos_resolve_session_request(
  p_session_id uuid,
  p_kind public.session_request_kind
)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  bid uuid;
  requested timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_kind is null then raise exception 'INVALID_REQUEST'; end if;
  -- Igual que el cierre: la autorización se resuelve antes de informar si la
  -- sesión existe, y antes de bloquear la fila.
  if not exists (select 1 from profiles where id = auth.uid())
    or not public.can_read_session(p_session_id, 'sessions.attend')
    then raise exception 'FORBIDDEN'; end if;

  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  bid := target.branch_id;
  if not public.has_permission(target.restaurant_id, 'sessions.attend', bid)
    then raise exception 'FORBIDDEN'; end if;

  requested := case p_kind
    when 'bill' then target.bill_requested_at
    else target.in_person_payment_requested_at end;
  -- Nada que atender: sin fila de auditoría, para que dos mozos tocando el
  -- mismo botón no registren dos atenciones de una sola solicitud. Tampoco se
  -- pisa la confirmación que ya está viendo la mesa.
  if requested is null then return null; end if;

  update public.table_sessions set
    bill_requested_at = case
      when p_kind = 'bill' then null else bill_requested_at end,
    bill_attended_at = case
      when p_kind = 'bill' then now() else bill_attended_at end,
    in_person_payment_requested_at = case
      when p_kind = 'in_person_payment' then null else in_person_payment_requested_at end,
    in_person_payment_attended_at = case
      when p_kind = 'in_person_payment' then now() else in_person_payment_attended_at end,
    -- Atender la mesa es operarla: queda como responsable quien fue.
    assigned_user_id = auth.uid()
  where id = target.id;

  perform public.record_pos_action(
    target.restaurant_id, bid, 'session.request_attended', null, target.id,
    jsonb_build_object('kind', p_kind, 'requestedAt', requested));
  return requested;
end;
$$;

create or replace function public.request_session_service(
  p_session_id uuid,
  p_kind public.session_request_kind
)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
  requested timestamptz;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_kind is null then raise exception 'INVALID_REQUEST'; end if;
  -- Pedir la cuenta es del comensal. Un empleado atiende la mesa desde el POS,
  -- igual que no puede sumarse a una sesión por QR (join_table_session).
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'FORBIDDEN'; end if;

  -- Se bloquea la fila: dos comensales tocando el botón a la vez dejan una sola
  -- solicitud, con la hora del primero.
  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;
  if not exists (
    select 1 from public.session_participants
    where session_id = p_session_id and user_id = auth.uid()
  ) then raise exception 'NOT_PARTICIPANT'; end if;

  -- Pedir la cuenta no es pagar: eso se puede siempre. Que venga un mozo a
  -- cobrar sí es un medio de pago, y la sucursal puede no ofrecerlo (MI-48).
  if p_kind = 'in_person_payment' and not exists (
    select 1 from public.branches b
    where b.id = target.branch_id and 'in_person' = any (b.payment_methods)
  ) then raise exception 'PAYMENT_METHOD_DISABLED'; end if;

  requested := case p_kind
    when 'bill' then target.bill_requested_at
    else target.in_person_payment_requested_at end;
  -- Ya hay una solicitud viva de este tipo: se devuelve la misma hora sin
  -- escribir, así el plano tampoco se despierta por un toque repetido.
  if requested is not null then return requested; end if;

  requested := now();
  -- Pedir de nuevo borra la confirmación anterior: lo último que pasó es que la
  -- mesa volvió a llamar.
  update public.table_sessions set
    bill_requested_at = case
      when p_kind = 'bill' then requested else bill_requested_at end,
    bill_attended_at = case
      when p_kind = 'bill' then null else bill_attended_at end,
    in_person_payment_requested_at = case
      when p_kind = 'in_person_payment' then requested else in_person_payment_requested_at end,
    in_person_payment_attended_at = case
      when p_kind = 'in_person_payment' then null else in_person_payment_attended_at end
  where id = target.id;
  return requested;
end;
$$;

-- Trasladar es de mesa a mesa: una cuenta sin mesa nunca coincide con el
-- origen esperado. Con `<>` un table_id nulo daba null y dejaba pasar el
-- traslado hasta que lo frenaba el check de kind.
create or replace function public.pos_move_table_session(
  p_session_id uuid,
  p_source_table_id uuid,
  p_destination_table_id uuid
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare source_table public.tables; destination public.tables; target public.table_sessions;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_source_table_id is null or p_destination_table_id is null
    or p_source_table_id = p_destination_table_id then raise exception 'INVALID_REQUEST'; end if;
  -- Orden estable entre las dos mesas para serializar traslados competidores.
  perform id from tables where id in (p_source_table_id, p_destination_table_id) order by id for update;
  select * into source_table from tables where id = p_source_table_id;
  if not found then raise exception 'TABLE_NOT_FOUND'; end if;
  select * into destination from tables where id = p_destination_table_id;
  if not found then raise exception 'TABLE_NOT_FOUND'; end if;
  if destination.restaurant_id <> source_table.restaurant_id then raise exception 'FORBIDDEN'; end if;
  if destination.branch_id <> source_table.branch_id then raise exception 'TABLE_BRANCH_MISMATCH'; end if;
  -- El permiso se exige en la sucursal de origen; el destino comparte sucursal.
  if not exists(select 1 from profiles where id = auth.uid())
    or not public.has_permission(source_table.restaurant_id,'sessions.move',source_table.branch_id)
    then raise exception 'FORBIDDEN'; end if;

  select * into target from table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.restaurant_id <> source_table.restaurant_id then raise exception 'FORBIDDEN'; end if;
  -- El origen esperado evita mover otra vez una comanda ya trasladada.
  if target.status <> 'open' or target.table_id is distinct from source_table.id then
    raise exception 'SESSION_MOVE_CONFLICT'; end if;
  if not destination.is_active or not destination.is_visible
    or not exists(select 1 from branches where id = destination.branch_id and is_active)
    or (destination.section_id is not null and not exists(
      select 1 from floor_sections where id = destination.section_id and is_active))
    then raise exception 'TABLE_UNAVAILABLE'; end if;
  if exists(select 1 from table_sessions where table_id = destination.id and status = 'open')
    then raise exception 'TABLE_OCCUPIED'; end if;

  -- Pedidos, participantes, pagos y reparto siguen colgando del mismo id.
  update table_sessions set table_id = destination.id, assigned_user_id = auth.uid() where id = target.id;
  perform public.record_pos_action(source_table.restaurant_id, source_table.branch_id,
    'session.moved', null, target.id, jsonb_build_object(
      'sourceTableId', source_table.id, 'sourceTableLabel', source_table.label,
      'destinationTableId', destination.id, 'destinationTableLabel', destination.label));
  return target.id;
end;
$$;

-- La tarjeta de cuenta abierta: la sucursal sale de la cuenta y la mesa es
-- opcional. kind va al final porque una vista solo admite columnas nuevas ahí.
create or replace view public.pos_open_sessions with (security_invoker = true) as
select s.id,
  s.restaurant_id,
  s.table_id,
  s.opened_at,
  t.label as table_label,
  s.branch_id,
  b.name as branch_name,
  coalesce(p.names, '{}'::text[]) as participant_names,
  coalesce(bill.submitted_amount, 0::numeric) as submitted_amount,
  coalesce(bill.total_amount, 0::numeric) as total_amount,
  coalesce(bill.paid_amount, 0::numeric) as paid_amount,
  coalesce(bill.pending_amount, 0::numeric) as pending_amount,
  s.bill_requested_at,
  s.bill_attended_at,
  s.in_person_payment_requested_at,
  s.in_person_payment_attended_at,
  k.tickets as kitchen_tickets,
  s.kind
from public.table_sessions s
left join public.tables t on t.id = s.table_id
join public.branches b on b.id = s.branch_id
left join public.session_bills bill on bill.session_id = s.id
left join lateral (
  select array_agg(sp.display_name order by sp.joined_at) as names
  from public.session_participants sp
  where sp.session_id = s.id
) p on true
left join lateral (
  select count(*)::integer as tickets
  from public.orders o
  where o.session_id = s.id and exists (
    select 1 from public.order_status_transitions tr
    where tr.from_status = o.status and tr.kind = 'advance'
  )
) k on true
where s.status = 'open';

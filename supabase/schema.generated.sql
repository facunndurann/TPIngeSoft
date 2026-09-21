


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."member_role" AS ENUM (
    'owner',
    'staff',
    'manager',
    'supervisor',
    'waiter',
    'cashier',
    'kitchen'
);


ALTER TYPE "public"."member_role" OWNER TO "postgres";


CREATE TYPE "public"."menu_design" AS ENUM (
    'oliva',
    'brasas',
    'linterna'
);


ALTER TYPE "public"."menu_design" OWNER TO "postgres";


CREATE TYPE "public"."order_status" AS ENUM (
    'submitted',
    'accepted',
    'in_preparation',
    'ready',
    'delivered',
    'cancelled'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE TYPE "public"."order_transition_kind" AS ENUM (
    'advance',
    'revert',
    'cancel'
);


ALTER TYPE "public"."order_transition_kind" OWNER TO "postgres";


CREATE TYPE "public"."payment_method" AS ENUM (
    'mobile',
    'in_person',
    'external'
);


ALTER TYPE "public"."payment_method" OWNER TO "postgres";


COMMENT ON TYPE "public"."payment_method" IS 'Medios con los que un local acepta que se salde la cuenta: mobile = pago electrónico desde la app (MI-40), in_person = un mozo cobra en la mesa (MI-46), external = se arregla fuera de la app (caja, efectivo, transferencia).';



CREATE TYPE "public"."payment_mode" AS ENUM (
    'full',
    'own',
    'equal_split',
    'custom',
    'percentage_split'
);


ALTER TYPE "public"."payment_mode" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."pos_type" AS ENUM (
    'internal',
    'fudo'
);


ALTER TYPE "public"."pos_type" OWNER TO "postgres";


CREATE TYPE "public"."session_request_kind" AS ENUM (
    'bill',
    'in_person_payment'
);


ALTER TYPE "public"."session_request_kind" OWNER TO "postgres";


CREATE TYPE "public"."session_status" AS ENUM (
    'open',
    'closed'
);


ALTER TYPE "public"."session_status" OWNER TO "postgres";


CREATE TYPE "public"."split_type" AS ENUM (
    'none',
    'equal',
    'percentages'
);


ALTER TYPE "public"."split_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."abandon_order_request"("p_session_id" "uuid", "p_request_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  participant uuid;
  existing_order uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null or p_request_id is null then raise exception 'INVALID_REQUEST'; end if;

  -- Mismo orden de locks que submit_order (mesa y después sesión): si hay un
  -- envío de esta sesión en curso, esperamos a que confirme o falle.
  perform 1 from public.tables t
    join public.table_sessions s on s.table_id = t.id
    where s.id = p_session_id for share of t;
  perform 1 from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  select id into participant from public.session_participants
    where session_id = p_session_id and user_id = auth.uid();
  if participant is null then raise exception 'NOT_PARTICIPANT'; end if;

  select id into existing_order from public.orders
    where submitted_by = participant and request_id = p_request_id;
  if found then return existing_order; end if;

  insert into public.abandoned_order_requests (participant_id, request_id)
    values (participant, p_request_id)
    on conflict do nothing;
  return null;
end;
$$;


ALTER FUNCTION "public"."abandon_order_request"("p_session_id" "uuid", "p_request_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."abandon_order_request"("p_session_id" "uuid", "p_request_id" "uuid") IS 'Participants only. Returns the order id if the request already created one; otherwise returns null and guarantees the request id never becomes an order. Errors: AUTH_REQUIRED, INVALID_REQUEST, SESSION_NOT_FOUND, NOT_PARTICIPANT.';



CREATE OR REPLACE FUNCTION "public"."audit_employee_password_reset"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid", "p_completed" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.authorize_employee_change(p_actor,p_restaurant,p_user,'{}',true);
  insert into pos_audit_log(restaurant_id,actor_user_id,user_id,action,details)
    values(p_restaurant,p_actor,p_actor,case when p_completed then 'account.password_reset' else 'account.password_reset_requested' end,
      jsonb_build_object('accountId',p_user,'actorName',coalesce((select full_name from profiles where id=p_actor),'Administrador')));
end;
$$;


ALTER FUNCTION "public"."audit_employee_password_reset"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid", "p_completed" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."authorize_employee_change"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid" DEFAULT NULL::"uuid", "p_roles" "public"."member_role"[] DEFAULT '{}'::"public"."member_role"[], "p_global" boolean DEFAULT false) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare actor_owner boolean;
begin
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform set_config('request.jwt.claims',
    (coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') || jsonb_build_object('sub',p_actor))::text,true);
  if not public.has_permission(p_restaurant,'employees.manage') then raise exception 'FORBIDDEN'; end if;
  select exists(select 1 from restaurant_members where user_id=p_actor and restaurant_id=p_restaurant
    and role='owner' and is_active) into actor_owner;
  if p_roles && array['owner','staff']::public.member_role[]
    or (not actor_owner and 'manager' = any(p_roles)) then raise exception 'FORBIDDEN'; end if;
  if p_user is not null then
    if not exists(select 1 from profiles where id=p_user) then raise exception 'FORBIDDEN'; end if;
    if exists(select 1 from restaurant_members where user_id=p_user and
      (role='owner' or (not actor_owner and role='manager'))) then raise exception 'FORBIDDEN'; end if;
    if p_global and exists(select 1 from restaurant_members where user_id=p_user
      and not public.has_permission(restaurant_id,'employees.manage')) then raise exception 'FORBIDDEN'; end if;
    -- Attaching an existing account also requires authority over its current
    -- memberships; a restaurant cannot claim somebody by guessing a username.
    if not exists(select 1 from restaurant_members where user_id=p_user and restaurant_id=p_restaurant)
      and exists(select 1 from restaurant_members where user_id=p_user
        and not public.has_permission(restaurant_id,'employees.manage')) then raise exception 'FORBIDDEN'; end if;
  end if;
  return true;
end;
$$;


ALTER FUNCTION "public"."authorize_employee_change"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid", "p_roles" "public"."member_role"[], "p_global" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_media"("object_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return public.is_restaurant_admin(split_part(object_name,'/',1)::uuid);
exception when invalid_text_representation then return false;
end;
$$;


ALTER FUNCTION "public"."can_manage_media"("object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_coworker"("uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists(select 1 from restaurant_members m
    join branch_memberships bm on bm.membership_id=m.id
    where m.user_id=uid and m.is_active and public.has_permission(m.restaurant_id,'floor.read',bm.branch_id));
$$;


ALTER FUNCTION "public"."can_read_coworker"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_read_session"("sid" "uuid", "permission_name" "text" DEFAULT 'orders.read'::"text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from table_sessions s join tables t on t.id = s.table_id
    where s.id = sid and t.restaurant_id = s.restaurant_id and (
      (public.is_restaurant_admin(s.restaurant_id) and not exists(select 1 from profiles where id=auth.uid())) or
      public.has_permission(s.restaurant_id, permission_name, t.branch_id)
    ));
$$;


ALTER FUNCTION "public"."can_read_session"("sid" "uuid", "permission_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_table_session"("p_session_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.pos_close_table_session(p_session_id);
$$;


ALTER FUNCTION "public"."close_table_session"("p_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."close_table_session"("p_session_id" "uuid") IS 'Tenant members close a table session. Idempotent if already closed. Errors: AUTH_REQUIRED, INVALID_REQUEST, SESSION_NOT_FOUND, FORBIDDEN.';



CREATE OR REPLACE FUNCTION "public"."create_mobile_payment"("p_session_id" "uuid", "p_request_id" "uuid", "p_mode" "public"."payment_mode" DEFAULT 'full'::"public"."payment_mode", "p_item_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("payment_id" "uuid", "amount" numeric, "status" "public"."payment_status")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  select b.payment_methods into methods from public.tables t
    join public.branches b on b.id=t.branch_id and b.restaurant_id=t.restaurant_id
    where t.id=target.table_id and t.restaurant_id=target.restaurant_id;
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


ALTER FUNCTION "public"."create_mobile_payment"("p_session_id" "uuid", "p_request_id" "uuid", "p_mode" "public"."payment_mode", "p_item_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_restaurant"("p_name" "text", "p_slug" "text", "p_menu_design" "public"."menu_design", "p_branch_name" "text", "p_description" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_restaurant_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if (select is_anonymous from auth.users where id = auth.uid()) is not false
    or exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_branch_name), '') is null
    or p_menu_design is null or p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'INVALID_REQUEST';
  end if;

  begin
    insert into public.restaurants(name, slug, description, menu_design)
      values (trim(p_name), p_slug, nullif(trim(p_description), ''), p_menu_design)
      returning id into v_restaurant_id;
  exception when unique_violation then
    raise exception 'SLUG_TAKEN';
  end;
  insert into public.restaurant_members(restaurant_id, user_id, role)
    values (v_restaurant_id, auth.uid(), 'owner');
  insert into public.branches(restaurant_id, name)
    values (v_restaurant_id, trim(p_branch_name));
  insert into public.pos_integrations(restaurant_id, type)
    values (v_restaurant_id, 'internal');
  return v_restaurant_id;
end;
$_$;


ALTER FUNCTION "public"."create_restaurant"("p_name" "text", "p_slug" "text", "p_menu_design" "public"."menu_design", "p_branch_name" "text", "p_description" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_restaurant"("p_name" "text", "p_slug" "text", "p_menu_design" "public"."menu_design", "p_branch_name" "text", "p_description" "text") IS 'Atomic onboarding: restaurant, owner membership, first branch and internal POS. Non-anonymous users only. Errors: AUTH_REQUIRED, FORBIDDEN, INVALID_REQUEST, SLUG_TAKEN.';



CREATE OR REPLACE FUNCTION "public"."customer_dispatch_internal_order"("p_order_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  target public.orders;
  integration public.pos_integrations;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into target from public.orders where id = p_order_id for update;
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


ALTER FUNCTION "public"."customer_dispatch_internal_order"("p_order_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."customer_dispatch_internal_order"("p_order_id" "uuid") IS 'Internal, idempotent POS acceptance used by submit_order and transition_order. Errors: AUTH_REQUIRED, ORDER_NOT_FOUND, FORBIDDEN, POS_UNAVAILABLE, POS_UNSUPPORTED.';



CREATE OR REPLACE FUNCTION "public"."customer_join_table_session"("qr" "text", "participant_name" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  target public.tables;
  sid uuid;
  -- Null cuando el comensal entra sin nombre: no se puede dar por elegido el default.
  named timestamptz := case when participant_name is not null then now() end;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  if participant_name is not null
     and (length(trim(participant_name)) < 1 or length(trim(participant_name)) > 40) then
    raise exception 'INVALID_NAME';
  end if;

  select t.* into target from public.tables t
    join public.branches b on b.id = t.branch_id
    where t.qr_token = qr and t.is_active and b.is_active for update of t;
  if not found then raise exception 'TABLE_UNAVAILABLE'; end if;

  select id into sid from public.table_sessions
    where table_id = target.id and status = 'open' for update;
  if sid is null then
    insert into public.table_sessions(restaurant_id, table_id)
      values(target.restaurant_id, target.id) returning id into sid;
  end if;

  insert into public.session_participants(session_id, user_id, display_name, named_at)
    values(sid, auth.uid(), coalesce(trim(participant_name), 'Comensal'), named)
    on conflict (session_id, user_id) do update
      set display_name = coalesce(trim(participant_name), session_participants.display_name),
          -- Volver a entrar sin nombre no borra el que ya se eligió.
          named_at = coalesce(named, session_participants.named_at);

  return sid;
end;
$$;


ALTER FUNCTION "public"."customer_join_table_session"("qr" "text", "participant_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_pos_employee"("p_restaurant_id" "uuid", "p_employee_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_employee public.pos_employees;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_restaurant_id is null or p_employee_id is null then raise exception 'INVALID_REQUEST'; end if;
  if not public.is_restaurant_admin(p_restaurant_id) then raise exception 'FORBIDDEN'; end if;

  select * into v_employee
    from public.pos_employees
    where id = p_employee_id and restaurant_id = p_restaurant_id
    for update;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;

  -- Al borrar, la FK pone employee_id en null. Guardamos primero una foto del
  -- actor para que las acciones anteriores no parezcan hechas por el admin.
  update public.pos_audit_log
    set details = details || jsonb_build_object(
      'employeeId', v_employee.id,
      'employeeName', v_employee.full_name
    )
    where employee_id = v_employee.id;

  delete from public.pos_employees where id = v_employee.id;

  insert into public.pos_audit_log(restaurant_id, user_id, action, details)
    values(p_restaurant_id, auth.uid(), 'employee.deleted', jsonb_build_object(
      'employeeId', v_employee.id,
      'employeeName', v_employee.full_name
    ));

  return v_employee.id;
end;
$$;


ALTER FUNCTION "public"."delete_pos_employee"("p_restaurant_id" "uuid", "p_employee_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_pos_employee"("p_restaurant_id" "uuid", "p_employee_id" "uuid") IS 'Elimina un empleado POS y conserva su identidad en la auditoría; solo owner. Errores: AUTH_REQUIRED, INVALID_REQUEST, FORBIDDEN, EMPLOYEE_NOT_FOUND.';



CREATE OR REPLACE FUNCTION "public"."dispatch_internal_order"("p_order_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if exists(select 1 from profiles where id=auth.uid()) then
    return public.pos_transition_order(p_order_id,'accepted');
  end if;
  if not exists(select 1 from orders o join session_participants p on p.id=o.submitted_by
    where o.id=p_order_id and p.user_id=auth.uid() and p.session_id=o.session_id)
    then raise exception 'FORBIDDEN'; end if;
  return public.customer_dispatch_internal_order(p_order_id);
end;
$$;


ALTER FUNCTION "public"."dispatch_internal_order"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."employee_catalog_access"("rid" "uuid", "bid" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select not exists(select 1 from profiles where id = auth.uid())
    or public.is_restaurant_admin(rid)
    or public.has_permission(rid, 'orders.read', bid);
$$;


ALTER FUNCTION "public"."employee_catalog_access"("rid" "uuid", "bid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."employee_email_exists"("p_email" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists(select 1 from auth.users where lower(email) = lower(btrim(p_email)));
$$;


ALTER FUNCTION "public"."employee_email_exists"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_order_pos_type"("p_order_id" "uuid") RETURNS "public"."pos_type"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare target public.orders; integration public.pos_integrations;
begin
  select * into target from orders o where o.id=p_order_id and (
    public.can_read_session(o.session_id) or public.is_session_participant(o.session_id));
  if not found then raise exception 'FORBIDDEN'; end if;
  select * into integration from pos_integrations where restaurant_id=target.restaurant_id;
  if not found then return 'internal'; end if;
  if not integration.is_active then raise exception 'POS_UNAVAILABLE'; end if;
  return integration.type;
end;
$$;


ALTER FUNCTION "public"."get_order_pos_type"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_pos_contexts"() RETURNS TABLE("restaurant_id" "uuid", "restaurant_name" "text", "branch_id" "uuid", "branch_name" "text", "full_name" "text", "permissions" "text"[])
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.id, r.name, b.id, b.name, p.full_name,
    array(select distinct rp.permission from role_permissions rp
      where rp.role = any(array[m.role] || m.additional_roles) and rp.permission not in ('admin.manage','employees.manage','audit.read'))
  from restaurant_members m join profiles p on p.id = m.user_id
  join restaurants r on r.id = m.restaurant_id
  join branch_memberships bm on bm.membership_id = m.id
  join branches b on b.id = bm.branch_id and b.restaurant_id = m.restaurant_id
  where m.user_id = auth.uid() and m.is_active and b.is_active
    and public.has_permission(r.id,'orders.read',b.id)
  order by r.name,b.name;
$$;


ALTER FUNCTION "public"."get_pos_contexts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_permission"("rid" "uuid", "permission_name" "text", "bid" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select auth.uid() is not null and exists (
    select 1 from restaurant_members m
    join role_permissions rp on rp.role = any(array[m.role] || m.additional_roles)
    where m.user_id = auth.uid() and m.restaurant_id = rid and m.is_active
      and rp.permission = permission_name
      and (bid is null or exists (
        select 1 from branch_memberships bm join branches b on b.id = bm.branch_id
        where bm.membership_id = m.id and bm.branch_id = bid and b.is_active
      ))
  );
$$;


ALTER FUNCTION "public"."has_permission"("rid" "uuid", "permission_name" "text", "bid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_restaurant_admin"("rid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.has_permission(rid, 'admin.manage');
$$;


ALTER FUNCTION "public"."is_restaurant_admin"("rid" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_restaurant_admin"("rid" "uuid") IS 'True si auth.uid() es owner del restaurante. Separa administración de operación.';



CREATE OR REPLACE FUNCTION "public"."is_restaurant_member"("rid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_restaurant_admin(rid);
$$;


ALTER FUNCTION "public"."is_restaurant_member"("rid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_session_participant"("sid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.session_participants
    where session_id = sid and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_session_participant"("sid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_table_session"("qr" "text", "participant_name" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if exists(select 1 from profiles where id=auth.uid()) then raise exception 'FORBIDDEN'; end if;
  return public.customer_join_table_session(qr,participant_name);
end;
$$;


ALTER FUNCTION "public"."join_table_session"("qr" "text", "participant_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_employee_accounts"("p_restaurant" "uuid") RETURNS TABLE("user_id" "uuid", "username" "text", "full_name" "text", "roles" "public"."member_role"[], "is_active" boolean, "branch_ids" "uuid"[])
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.has_permission(p_restaurant,'employees.manage') then raise exception 'FORBIDDEN'; end if;
  return query select p.id,p.username_normalized,p.full_name,array[m.role] || m.additional_roles,m.is_active,
    array(select bm.branch_id from branch_memberships bm where bm.membership_id=m.id)
    from restaurant_members m join profiles p on p.id=m.user_id
    where m.restaurant_id=p_restaurant order by p.full_name;
end;
$$;


ALTER FUNCTION "public"."list_employee_accounts"("p_restaurant" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pos_close_table_session"("p_session_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare target public.table_sessions; bid uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from profiles where id=auth.uid()) or
    not public.can_read_session(p_session_id,'sessions.close') then raise exception 'FORBIDDEN'; end if;
  -- Same table/session lock order as join/submit.
  perform 1 from tables t join table_sessions s on s.table_id=t.id where s.id=p_session_id for update of t;
  select * into target from table_sessions where id=p_session_id for update;
  select branch_id into bid from tables where id=target.table_id and restaurant_id=target.restaurant_id;
  if bid is null or not public.has_permission(target.restaurant_id,'sessions.close',bid) then raise exception 'FORBIDDEN'; end if;
  if target.status='closed' then return target.id; end if;
  update table_sessions set status='closed',closed_at=now() where id=target.id;
  perform public.record_pos_action(target.restaurant_id,bid,'session.closed',null,target.id);
  insert into integration_logs(restaurant_id,event,payload)
    values(target.restaurant_id,'session.closed',jsonb_build_object('sessionId',target.id,'actorId',auth.uid()));
  return target.id;
end;
$$;


ALTER FUNCTION "public"."pos_close_table_session"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pos_move_table_session"("p_session_id" "uuid", "p_source_table_id" "uuid", "p_destination_table_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  if target.status <> 'open' or target.table_id <> source_table.id then
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


ALTER FUNCTION "public"."pos_move_table_session"("p_session_id" "uuid", "p_source_table_id" "uuid", "p_destination_table_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pos_open_table_session"("p_table_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare target public.tables; sid uuid; created boolean := false;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_table_id is null then raise exception 'INVALID_REQUEST'; end if;
  -- Mismo orden de bloqueo mesa -> sesión que join/close: dos aperturas
  -- simultáneas se serializan acá y la idempotencia evita duplicados.
  select * into target from tables where id = p_table_id for update;
  if not found then raise exception 'TABLE_NOT_FOUND'; end if;
  -- La cuenta administrativa no opera el salón: el POS es de empleados.
  if not exists(select 1 from profiles where id = auth.uid())
    or not public.has_permission(target.restaurant_id,'sessions.open',target.branch_id)
    then raise exception 'FORBIDDEN'; end if;
  -- Misma regla de operabilidad que dibuja el plano (MI-66).
  if not target.is_active or not target.is_visible
    or not exists(select 1 from branches where id = target.branch_id and is_active)
    or (target.section_id is not null and not exists(
      select 1 from floor_sections where id = target.section_id and is_active))
    then raise exception 'TABLE_UNAVAILABLE'; end if;

  select id into sid from table_sessions where table_id = target.id and status = 'open' for update;
  if sid is null then
    insert into table_sessions(restaurant_id, table_id, assigned_user_id)
      values(target.restaurant_id, target.id, auth.uid()) returning id into sid;
    created := true;
  else
    -- Continuar también deja al operador actual como responsable de la mesa.
    update table_sessions set assigned_user_id = auth.uid() where id = sid;
  end if;
  perform public.record_pos_action(target.restaurant_id, target.branch_id,
    case when created then 'session.opened' else 'session.resumed' end, null, sid,
    jsonb_build_object('tableId', target.id, 'tableLabel', target.label));
  return sid;
end;
$$;


ALTER FUNCTION "public"."pos_open_table_session"("p_table_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pos_record_payment"("p_session_id" "uuid", "p_amount" numeric, "p_method" "public"."payment_method", "p_mode" "public"."payment_mode" DEFAULT 'full'::"public"."payment_mode", "p_participant_id" "uuid" DEFAULT NULL::"uuid", "p_external_reference" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

  select t.branch_id, b.payment_methods into target_branch, enabled_methods
  from public.tables t
  join public.branches b on b.id = t.branch_id and b.restaurant_id = t.restaurant_id
  where t.id = target.table_id and t.restaurant_id = target.restaurant_id;
  if target_branch is null then raise exception 'TABLE_NOT_FOUND'; end if;
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


ALTER FUNCTION "public"."pos_record_payment"("p_session_id" "uuid", "p_amount" numeric, "p_method" "public"."payment_method", "p_mode" "public"."payment_mode", "p_participant_id" "uuid", "p_external_reference" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pos_resolve_session_request"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  select branch_id into bid from public.tables
    where id = target.table_id and restaurant_id = target.restaurant_id;
  if bid is null or not public.has_permission(target.restaurant_id, 'sessions.attend', bid)
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


ALTER FUNCTION "public"."pos_resolve_session_request"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."pos_resolve_session_request"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") IS 'MI-47: marca atendida la solicitud de una mesa y la audita. Devuelve la hora que tenía la solicitud, o null si no había ninguna. Errores: AUTH_REQUIRED, INVALID_REQUEST, FORBIDDEN, SESSION_NOT_FOUND.';



CREATE OR REPLACE FUNCTION "public"."pos_transition_order"("p_order_id" "uuid", "p_status" "public"."order_status") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare target public.orders; bid uuid; needed text; integration public.pos_integrations; reverting boolean;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Filter authorization before returning existence/state information or locking.
  select o.* into target from orders o where o.id=p_order_id
    and public.can_read_session(o.session_id) for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  select t.branch_id into bid from table_sessions s join tables t on t.id=s.table_id
    where s.id=target.session_id and t.restaurant_id=target.restaurant_id;
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


ALTER FUNCTION "public"."pos_transition_order"("p_order_id" "uuid", "p_status" "public"."order_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_pos_action"("p_restaurant_id" "uuid", "p_branch_id" "uuid", "p_action" "text", "p_order_id" "uuid", "p_session_id" "uuid", "p_details" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null or not public.has_permission(p_restaurant_id,'orders.read',p_branch_id)
    then raise exception 'FORBIDDEN'; end if;
  insert into pos_audit_log(restaurant_id,branch_id,actor_user_id,user_id,action,order_id,session_id,details)
    values(p_restaurant_id,p_branch_id,auth.uid(),auth.uid(),p_action,p_order_id,p_session_id,
      coalesce(p_details,'{}') || jsonb_build_object('actorName',(select full_name from profiles where id=auth.uid())));
end;
$$;


ALTER FUNCTION "public"."record_pos_action"("p_restaurant_id" "uuid", "p_branch_id" "uuid", "p_action" "text", "p_order_id" "uuid", "p_session_id" "uuid", "p_details" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_abandoned_order_request"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- submit_order inserta con la sesión bloqueada (for update), igual que
  -- abandon_order_request, así que esta lectura ve cualquier abandono confirmado.
  if exists (
    select 1 from public.abandoned_order_requests
    where participant_id = new.submitted_by and request_id = new.request_id
  ) then
    raise exception 'REQUEST_ABANDONED';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."reject_abandoned_order_request"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_categories"("p_restaurant_id" "uuid", "p_category_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_restaurant_member(p_restaurant_id) then raise exception 'FORBIDDEN'; end if;

  -- Serializa reordenamientos concurrentes del mismo restaurante.
  perform 1 from public.menu_categories where restaurant_id = p_restaurant_id for update;
  -- La lista debe ser exactamente las categorías actuales. Comparar ambas listas
  -- ordenadas detecta a la vez faltantes, ajenas y repetidas.
  if (select array_agg(id order by id) from public.menu_categories where restaurant_id = p_restaurant_id)
    is distinct from (select array_agg(id order by id) from unnest(p_category_ids) as id) then
    raise exception 'STALE_DATA';
  end if;

  -- La posición en la lista pasa a ser el sort_order (0..n-1, sin empates).
  update public.menu_categories c set sort_order = o.position - 1
    from unnest(p_category_ids) with ordinality as o(id, position)
    where c.id = o.id;
end;
$$;


ALTER FUNCTION "public"."reorder_categories"("p_restaurant_id" "uuid", "p_category_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reorder_categories"("p_restaurant_id" "uuid", "p_category_ids" "uuid"[]) IS 'Members only; the list must contain exactly the current categories. Errors: AUTH_REQUIRED, FORBIDDEN, STALE_DATA.';



CREATE OR REPLACE FUNCTION "public"."request_session_service"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    select 1 from public.tables t
    join public.branches b on b.id = t.branch_id
    where t.id = target.table_id and 'in_person' = any (b.payment_methods)
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


ALTER FUNCTION "public"."request_session_service"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."request_session_service"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") IS 'MI-38/MI-46: un comensal de la mesa pide la cuenta o cobro presencial. Idempotente: devuelve la hora de la solicitud viva. Errores: AUTH_REQUIRED, INVALID_REQUEST, FORBIDDEN, SESSION_NOT_FOUND, SESSION_CLOSED, NOT_PARTICIPANT.';



CREATE OR REPLACE FUNCTION "public"."resolve_mobile_payment"("p_payment_id" "uuid", "p_user_id" "uuid", "p_status" "public"."payment_status") RETURNS TABLE("payment_id" "uuid", "amount" numeric, "status" "public"."payment_status")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  saved public.payments;
  target public.table_sessions;
  due numeric;
  final_status public.payment_status;
begin
  if p_payment_id is null or p_user_id is null or p_status not in ('approved','rejected')
    then raise exception 'INVALID_REQUEST'; end if;
  select * into saved from public.payments where id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if saved.method <> 'mobile' then raise exception 'INVALID_REQUEST'; end if;
  if not exists(select 1 from public.session_participants where id=saved.participant_id
    and session_id=saved.session_id and user_id=p_user_id)
    then raise exception 'FORBIDDEN'; end if;
  if saved.status <> 'pending' then
    return query select saved.id,saved.amount,saved.status; return;
  end if;

  select * into target from public.table_sessions where id=saved.session_id for update;
  final_status := p_status;
  if target.status <> 'open' then final_status := 'rejected'; end if;
  if final_status='approved' then
    select greatest(
      coalesce((select sum(o.total_amount) from public.orders o where o.session_id=target.id
        and o.restaurant_id=target.restaurant_id
        and o.status in ('accepted','in_preparation','ready','delivered')),0)
      - coalesce((select sum(p.amount) from public.payments p where p.session_id=target.id
        and p.restaurant_id=target.restaurant_id and p.status='approved'),0), 0
    ) into due;
    if due=0 or saved.amount>due then final_status := 'rejected'; end if;
  end if;
  update public.payments set status=final_status,updated_at=now() where id=saved.id
    returning * into saved;
  return query select saved.id,saved.amount,saved.status;
end;
$$;


ALTER FUNCTION "public"."resolve_mobile_payment"("p_payment_id" "uuid", "p_user_id" "uuid", "p_status" "public"."payment_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_employee_account"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid", "p_full_name" "text", "p_roles" "public"."member_role"[], "p_branches" "uuid"[], "p_active" boolean, "p_username" "text" DEFAULT NULL::"text", "p_legacy" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare mid uuid; existing_name text;
begin
  select full_name into existing_name from profiles where id=p_user for update;
  perform public.authorize_employee_change(p_actor,p_restaurant,
    case when existing_name is null then null else p_user end,p_roles,
    existing_name is distinct from btrim(p_full_name));
  if coalesce(cardinality(p_roles),0)=0 or coalesce(cardinality(p_branches),0)=0
    or p_active is null or length(btrim(p_full_name)) not between 1 and 100
    or p_roles && array['owner','staff']::public.member_role[]
    or array_position(p_roles,null) is not null or array_position(p_branches,null) is not null
    or (cardinality(p_roles)>1 and 'manager'=any(p_roles)) then raise exception 'INVALID_REQUEST'; end if;
  if exists(select 1 from unnest(p_branches) bid where not exists(
    select 1 from branches where id=bid and restaurant_id=p_restaurant and is_active))
    then raise exception 'FORBIDDEN'; end if;
  if existing_name is null then
    insert into profiles(id,username_normalized,full_name)
      values(p_user,lower(btrim(p_username)),btrim(p_full_name));
  elsif existing_name is distinct from btrim(p_full_name) then
    update profiles set full_name=btrim(p_full_name),updated_at=now() where id=p_user;
  end if;
  insert into restaurant_members(restaurant_id,user_id,role,additional_roles,is_active)
    values(p_restaurant,p_user,p_roles[1],p_roles[2:cardinality(p_roles)],p_active)
    on conflict(restaurant_id,user_id) do update set role=excluded.role,
      additional_roles=excluded.additional_roles,is_active=excluded.is_active returning id into mid;
  delete from branch_memberships where membership_id=mid;
  insert into branch_memberships(membership_id,restaurant_id,branch_id)
    select mid,p_restaurant,bid from (select distinct unnest(p_branches) bid) b;
  if p_legacy is not null then
    update pos_employees set is_active=false,migrated_user_id=p_user,updated_at=now()
      where id=p_legacy and restaurant_id=p_restaurant and migrated_user_id is null;
    if not found then raise exception 'INVALID_LEGACY_EMPLOYEE'; end if;
  end if;
  insert into pos_audit_log(restaurant_id,actor_user_id,user_id,action,details)
    values(p_restaurant,p_actor,p_actor,case when existing_name is null then 'account.created' else 'account.updated' end,
      jsonb_build_object('accountId',p_user,'fullName',btrim(p_full_name),'roles',p_roles,'branches',p_branches,'active',p_active,'legacyId',p_legacy,
        'actorName',coalesce((select full_name from profiles where id=p_actor),'Administrador')));
  return p_user;
end;
$$;


ALTER FUNCTION "public"."save_employee_account"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid", "p_full_name" "text", "p_roles" "public"."member_role"[], "p_branches" "uuid"[], "p_active" boolean, "p_username" "text", "p_legacy" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_modifier_group"("p_restaurant_id" "uuid", "p_name" "text", "p_min_select" integer, "p_max_select" integer, "p_is_available" boolean, "p_options" "jsonb", "p_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_group_id uuid := p_group_id;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_restaurant_member(p_restaurant_id) then raise exception 'FORBIDDEN'; end if;
  if nullif(trim(p_name), '') is null or jsonb_typeof(p_options) is distinct from 'array' then
    raise exception 'INVALID_REQUEST';
  end if;
  if jsonb_array_length(p_options) = 0 or exists (
    select 1 from jsonb_array_elements(p_options) o where nullif(trim(o->>'name'), '') is null
  ) then
    raise exception 'INVALID_REQUEST';
  end if;

  if v_group_id is null then
    insert into public.modifier_groups(restaurant_id, name, min_select, max_select, is_available)
      values (p_restaurant_id, trim(p_name), p_min_select, p_max_select, p_is_available)
      returning id into v_group_id;
  else
    update public.modifier_groups
      set name = trim(p_name), min_select = p_min_select, max_select = p_max_select,
        is_available = p_is_available
      where id = v_group_id and restaurant_id = p_restaurant_id;
    if not found then raise exception 'STALE_DATA'; end if;
  end if;

  -- Como la función saltea RLS, cada id recibido tiene que ser de este grupo:
  -- si no, el upsert de abajo podría editar opciones de otro grupo o restaurante.
  if exists (
    select 1 from jsonb_array_elements(p_options) o
    where o->>'id' is not null and not exists (
      select 1 from public.modifier_options existing
      where existing.id = (o->>'id')::uuid and existing.group_id = v_group_id)
  ) then
    raise exception 'STALE_DATA';
  end if;

  delete from public.modifier_options
    where group_id = v_group_id
      and id not in (
        select (o->>'id')::uuid from jsonb_array_elements(p_options) o where o->>'id' is not null);

  insert into public.modifier_options(id, restaurant_id, group_id, name, price_delta, is_available, sort_order)
    select coalesce((o.value->>'id')::uuid, gen_random_uuid()), p_restaurant_id, v_group_id,
      trim(o.value->>'name'), (o.value->>'price_delta')::numeric, (o.value->>'is_available')::boolean,
      o.position - 1
    from jsonb_array_elements(p_options) with ordinality as o(value, position)
  on conflict (id) do update
    set name = excluded.name, price_delta = excluded.price_delta,
      is_available = excluded.is_available, sort_order = excluded.sort_order;

  return v_group_id;
end;
$$;


ALTER FUNCTION "public"."save_modifier_group"("p_restaurant_id" "uuid", "p_name" "text", "p_min_select" integer, "p_max_select" integer, "p_is_available" boolean, "p_options" "jsonb", "p_group_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."save_modifier_group"("p_restaurant_id" "uuid", "p_name" "text", "p_min_select" integer, "p_max_select" integer, "p_is_available" boolean, "p_options" "jsonb", "p_group_id" "uuid") IS 'Members only; creates or replaces a group and its full option list atomically. Errors: AUTH_REQUIRED, FORBIDDEN, INVALID_REQUEST, STALE_DATA.';



CREATE OR REPLACE FUNCTION "public"."save_product"("p_restaurant_id" "uuid", "p_category_id" "uuid", "p_name" "text", "p_base_price" numeric, "p_dietary_tags" "text"[], "p_is_available" boolean, "p_media_urls" "text"[], "p_ingredients" "jsonb", "p_group_ids" "uuid"[], "p_product_id" "uuid" DEFAULT NULL::"uuid", "p_description" "text" DEFAULT NULL::"text", "p_food_info" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_product_id uuid := p_product_id;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_restaurant_member(p_restaurant_id) then raise exception 'FORBIDDEN'; end if;
  if nullif(trim(p_name), '') is null or p_base_price is null or p_base_price < 0
    or jsonb_typeof(p_ingredients) is distinct from 'array' then
    raise exception 'INVALID_REQUEST';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_ingredients) i where nullif(trim(i->>'name'), '') is null
  ) then
    raise exception 'INVALID_REQUEST';
  end if;

  if v_product_id is null then
    insert into public.products(restaurant_id, category_id, name, description, base_price,
      food_info, dietary_tags, is_available, media_urls)
    values (p_restaurant_id, p_category_id, trim(p_name), nullif(trim(p_description), ''), p_base_price,
      nullif(trim(p_food_info), ''), coalesce(p_dietary_tags, '{}'), p_is_available,
      coalesce(p_media_urls, '{}'))
    returning id into v_product_id;
  else
    update public.products
      set category_id = p_category_id, name = trim(p_name),
        description = nullif(trim(p_description), ''), base_price = p_base_price,
        food_info = nullif(trim(p_food_info), ''), dietary_tags = coalesce(p_dietary_tags, '{}'),
        is_available = p_is_available, media_urls = coalesce(p_media_urls, '{}')
      where id = v_product_id and restaurant_id = p_restaurant_id;
    if not found then raise exception 'STALE_DATA'; end if;
  end if;

  -- Mismo resguardo que en save_modifier_group: solo ingredientes de este producto.
  if exists (
    select 1 from jsonb_array_elements(p_ingredients) i
    where i->>'id' is not null and not exists (
      select 1 from public.product_ingredients existing
      where existing.id = (i->>'id')::uuid and existing.product_id = v_product_id)
  ) then
    raise exception 'STALE_DATA';
  end if;

  delete from public.product_ingredients
    where product_id = v_product_id
      and id not in (
        select (i->>'id')::uuid from jsonb_array_elements(p_ingredients) i where i->>'id' is not null);

  insert into public.product_ingredients(id, restaurant_id, product_id, name, is_removable, is_available, sort_order)
    select coalesce((i.value->>'id')::uuid, gen_random_uuid()), p_restaurant_id, v_product_id,
      trim(i.value->>'name'), (i.value->>'is_removable')::boolean, (i.value->>'is_available')::boolean,
      i.position - 1
    from jsonb_array_elements(p_ingredients) with ordinality as i(value, position)
  on conflict (id) do update
    set name = excluded.name, is_removable = excluded.is_removable,
      is_available = excluded.is_available, sort_order = excluded.sort_order;

  delete from public.product_modifier_groups
    where product_id = v_product_id and group_id <> all(coalesce(p_group_ids, '{}'));

  insert into public.product_modifier_groups(restaurant_id, product_id, group_id, sort_order)
    select p_restaurant_id, v_product_id, g.id, g.position - 1
    from unnest(p_group_ids) with ordinality as g(id, position)
  on conflict (product_id, group_id) do update set sort_order = excluded.sort_order;

  return v_product_id;
exception
  -- Categoría o grupo inexistente o de otro restaurante (FKs compuestas).
  when foreign_key_violation then raise exception 'STALE_DATA';
end;
$$;


ALTER FUNCTION "public"."save_product"("p_restaurant_id" "uuid", "p_category_id" "uuid", "p_name" "text", "p_base_price" numeric, "p_dietary_tags" "text"[], "p_is_available" boolean, "p_media_urls" "text"[], "p_ingredients" "jsonb", "p_group_ids" "uuid"[], "p_product_id" "uuid", "p_description" "text", "p_food_info" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."save_product"("p_restaurant_id" "uuid", "p_category_id" "uuid", "p_name" "text", "p_base_price" numeric, "p_dietary_tags" "text"[], "p_is_available" boolean, "p_media_urls" "text"[], "p_ingredients" "jsonb", "p_group_ids" "uuid"[], "p_product_id" "uuid", "p_description" "text", "p_food_info" "text") IS 'Members only; creates or replaces a product with its full ingredient list and group assignments atomically. Errors: AUTH_REQUIRED, FORBIDDEN, INVALID_REQUEST, STALE_DATA.';



CREATE OR REPLACE FUNCTION "public"."session_percentage_share"("p_session_id" "uuid", "p_participant_id" "uuid") RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with session_row as (
    select s.id, s.restaurant_id, s.split_type, s.split_allocations
    from public.table_sessions s
    where s.id = p_session_id and s.split_type = 'percentages'
  ),
  account as (
    select round(coalesce(sum(o.total_amount), 0) * 100)::bigint as cents
    from session_row s
    left join public.orders o
      on o.session_id = s.id and o.restaurant_id = s.restaurant_id
      and o.status in ('accepted', 'in_preparation', 'ready', 'delivered')
  ),
  shares as (
    select
      allocation.key::uuid as participant_id,
      floor(account.cents * (allocation.value)::numeric / 100) as cents,
      account.cents * (allocation.value)::numeric / 100
        - floor(account.cents * (allocation.value)::numeric / 100) as remainder
    from session_row s
    cross join account
    cross join lateral jsonb_each_text(s.split_allocations) as allocation
  ),
  ranked as (
    select participant_id, cents,
      row_number() over (order by remainder desc, participant_id) as position
    from shares
  ),
  leftover as (
    select (select cents from account) - coalesce(sum(cents), 0) as cents from ranked
  )
  select (ranked.cents + case when ranked.position <= (select cents from leftover) then 1 else 0 end)
    / 100::numeric
  from ranked
  where ranked.participant_id = p_participant_id;
$$;


ALTER FUNCTION "public"."session_percentage_share"("p_session_id" "uuid", "p_participant_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."session_percentage_share"("p_session_id" "uuid", "p_participant_id" "uuid") IS 'MI-43: parte de un comensal según split_allocations, sobre el total de la cuenta y por resto mayor. Null si la sesión no divide por porcentajes o si no tiene asignación.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "submitted_by" "uuid",
    "status" "public"."order_status" DEFAULT 'submitted'::"public"."order_status" NOT NULL,
    "total_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "preparing_at" timestamp with time zone,
    "ready_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "request_id" "uuid",
    "request_payload" "jsonb",
    "local_date" "date" GENERATED ALWAYS AS ((("created_at" AT TIME ZONE 'America/Argentina/Buenos_Aires'::"text"))::"date") STORED
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_order"("p_session_id" "uuid", "p_request_id" "uuid", "p_items" "jsonb", "p_expected_total" numeric, "p_notes" "text" DEFAULT NULL::"text") RETURNS "public"."orders"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."submit_order"("p_session_id" "uuid", "p_request_id" "uuid", "p_items" "jsonb", "p_expected_total" numeric, "p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."submit_order"("p_session_id" "uuid", "p_request_id" "uuid", "p_items" "jsonb", "p_expected_total" numeric, "p_notes" "text") IS 'Atomic order snapshot and internal POS acceptance; returns the saved order. Errors: AUTH_REQUIRED, INVALID_REQUEST, INVALID_ITEMS, SESSION_NOT_FOUND, NOT_PARTICIPANT, SESSION_CLOSED, TABLE_UNAVAILABLE, PRODUCT_UNAVAILABLE, INVALID_INGREDIENTS, INVALID_MODIFIERS, PRICE_CHANGED, IDEMPOTENCY_CONFLICT, REQUEST_ABANDONED, POS_UNAVAILABLE, POS_UNSUPPORTED.';



CREATE OR REPLACE FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_status" "public"."order_status") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.pos_transition_order(p_order_id,p_status);
$$;


ALTER FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_status" "public"."order_status") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_status" "public"."order_status") IS 'Tenant members only; applies a transition listed in order_status_transitions. Errors: AUTH_REQUIRED, ORDER_NOT_FOUND, FORBIDDEN, INVALID_TRANSITION, POS_UNAVAILABLE, POS_UNSUPPORTED.';



CREATE OR REPLACE FUNCTION "public"."update_session_split"("p_session_id" "uuid", "p_split_type" "public"."split_type", "p_allocations" "jsonb" DEFAULT '{}'::"jsonb", "p_equal_parts" integer DEFAULT NULL::integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  target public.table_sessions;
  allocations jsonb := coalesce(p_allocations, '{}'::jsonb);
  author uuid;
  total numeric;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if target.status <> 'open' then raise exception 'SESSION_CLOSED'; end if;
  select id into author from public.session_participants
    where session_id = p_session_id and user_id = auth.uid();
  if author is null then raise exception 'NOT_PARTICIPANT'; end if;
  if jsonb_typeof(allocations) <> 'object' then raise exception 'INVALID_SPLIT'; end if;

  if p_split_type = 'equal' then
    if allocations <> '{}'::jsonb or p_equal_parts is null
      or p_equal_parts < 2 or p_equal_parts > 50
      then raise exception 'INVALID_SPLIT'; end if;
    update public.table_sessions set
      split_type = p_split_type,
      split_allocations = '{}'::jsonb,
      split_equal_parts = p_equal_parts,
      split_updated_by = author,
      split_updated_at = now()
    where id = p_session_id;
    return;
  end if;

  if p_equal_parts is not null then raise exception 'INVALID_SPLIT'; end if;
  if p_split_type <> 'percentages' then
    if allocations <> '{}'::jsonb then raise exception 'INVALID_SPLIT'; end if;
    update public.table_sessions set
      split_type = p_split_type,
      split_allocations = '{}'::jsonb,
      split_equal_parts = null,
      split_updated_by = author,
      split_updated_at = now()
    where id = p_session_id;
    return;
  end if;

  if exists (
    select 1 from jsonb_each(allocations) a where jsonb_typeof(a.value) <> 'number'
  ) then raise exception 'INVALID_SPLIT'; end if;
  if exists (
    select 1 from jsonb_each(allocations) a
    where (a.value)::numeric < 0 or (a.value)::numeric > 100
  ) then raise exception 'INVALID_SPLIT'; end if;
  if exists (
    select 1 from jsonb_object_keys(allocations) as k(id)
    where k.id not in (
      select sp.id::text from public.session_participants sp where sp.session_id = p_session_id
    )
  ) then raise exception 'INVALID_SPLIT'; end if;
  select coalesce(sum((a.value)::numeric), 0) into total from jsonb_each(allocations) a;
  if total <> 100 then raise exception 'INVALID_SPLIT'; end if;

  update public.table_sessions set
    split_type = p_split_type,
    split_allocations = allocations,
    split_equal_parts = null,
    split_updated_by = author,
    split_updated_at = now()
  where id = p_session_id;
end;
$$;


ALTER FUNCTION "public"."update_session_split"("p_session_id" "uuid", "p_split_type" "public"."split_type", "p_allocations" "jsonb", "p_equal_parts" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_pos_employee"("p_restaurant_id" "uuid", "p_full_name" "text", "p_pin" "text" DEFAULT NULL::"text", "p_employee_id" "uuid" DEFAULT NULL::"uuid", "p_is_active" boolean DEFAULT true) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
declare
  v_name text := nullif(btrim(p_full_name), '');
  v_hash text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_restaurant_id is null or v_name is null then raise exception 'INVALID_REQUEST'; end if;
  if not public.is_restaurant_admin(p_restaurant_id) then raise exception 'FORBIDDEN'; end if;

  if p_pin is not null then
    if p_pin !~ '^[0-9]{4,8}$' then raise exception 'INVALID_PIN'; end if;
    -- Dos empleados activos con el mismo PIN harían ambiguo el desbloqueo.
    if exists (
      select 1 from public.pos_employees e
      where e.restaurant_id = p_restaurant_id
        and e.is_active
        and (p_employee_id is null or e.id <> p_employee_id)
        and e.pin_hash = crypt(p_pin, e.pin_hash)
    ) then raise exception 'PIN_TAKEN'; end if;
    v_hash := crypt(p_pin, gen_salt('bf'));
  end if;

  if p_employee_id is null then
    if v_hash is null then raise exception 'INVALID_PIN'; end if;
    begin
      insert into public.pos_employees(restaurant_id, full_name, pin_hash, is_active)
        values(p_restaurant_id, v_name, v_hash, coalesce(p_is_active, true))
        returning id into v_id;
    exception when unique_violation then raise exception 'NAME_TAKEN';
    end;
    insert into public.pos_audit_log(restaurant_id, employee_id, user_id, action, details)
      values(p_restaurant_id, v_id, auth.uid(), 'employee.created',
        jsonb_build_object('fullName', v_name));
    return v_id;
  end if;

  begin
    update public.pos_employees
      set full_name = v_name,
          is_active = coalesce(p_is_active, is_active),
          pin_hash = coalesce(v_hash, pin_hash),
          updated_at = now()
      where id = p_employee_id and restaurant_id = p_restaurant_id
      returning id into v_id;
  exception when unique_violation then raise exception 'NAME_TAKEN';
  end;
  if v_id is null then raise exception 'EMPLOYEE_NOT_FOUND'; end if;

  insert into public.pos_audit_log(restaurant_id, employee_id, user_id, action, details)
    values(p_restaurant_id, v_id, auth.uid(), 'employee.updated',
      jsonb_build_object('fullName', v_name, 'isActive', coalesce(p_is_active, true),
        'pinChanged', v_hash is not null));
  return v_id;
end;
$_$;


ALTER FUNCTION "public"."upsert_pos_employee"("p_restaurant_id" "uuid", "p_full_name" "text", "p_pin" "text", "p_employee_id" "uuid", "p_is_active" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."upsert_pos_employee"("p_restaurant_id" "uuid", "p_full_name" "text", "p_pin" "text", "p_employee_id" "uuid", "p_is_active" boolean) IS 'Alta/edición de empleados POS; solo owner. Errores: AUTH_REQUIRED, INVALID_REQUEST, FORBIDDEN, INVALID_PIN, PIN_TAKEN, NAME_TAKEN, EMPLOYEE_NOT_FOUND.';



CREATE OR REPLACE FUNCTION "public"."verify_pos_pin"("p_restaurant_id" "uuid", "p_pin" "text") RETURNS TABLE("id" "uuid", "full_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_employee public.pos_employees;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_restaurant_id is null or p_pin is null then raise exception 'INVALID_REQUEST'; end if;
  -- Operar el POS es de cualquier miembro; administrar empleados, solo del owner.
  if not public.is_restaurant_member(p_restaurant_id) then raise exception 'FORBIDDEN'; end if;

  select * into v_employee from public.pos_employees e
    where e.restaurant_id = p_restaurant_id
      and e.is_active
      and e.pin_hash = crypt(p_pin, e.pin_hash)
    limit 1;
  if not found then raise exception 'INVALID_PIN'; end if;

  insert into public.pos_audit_log(restaurant_id, employee_id, user_id, action)
    values(p_restaurant_id, v_employee.id, auth.uid(), 'pos.unlocked');

  id := v_employee.id;
  full_name := v_employee.full_name;
  return next;
end;
$$;


ALTER FUNCTION "public"."verify_pos_pin"("p_restaurant_id" "uuid", "p_pin" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."verify_pos_pin"("p_restaurant_id" "uuid", "p_pin" "text") IS 'Desbloquea el POS con PIN y audita el ingreso. Errores: AUTH_REQUIRED, INVALID_REQUEST, FORBIDDEN, INVALID_PIN.';



CREATE TABLE IF NOT EXISTS "public"."abandoned_order_requests" (
    "participant_id" "uuid" NOT NULL,
    "request_id" "uuid" NOT NULL,
    "abandoned_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."abandoned_order_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branch_memberships" (
    "membership_id" "uuid" NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL
);


ALTER TABLE "public"."branch_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payment_methods" "public"."payment_method"[] DEFAULT '{in_person,external}'::"public"."payment_method"[] NOT NULL
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


COMMENT ON COLUMN "public"."branches"."payment_methods" IS 'Medios de pago habilitados en la sucursal (MI-48). Vacío es válido: el local no cobra por la app, el comensal solo puede pedir la cuenta.';



CREATE TABLE IF NOT EXISTS "public"."floor_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."floor_sections" OWNER TO "postgres";


COMMENT ON TABLE "public"."floor_sections" IS 'Sectores del salón (MI-66). Agrupan mesas para el plano operativo del POS.';



CREATE TABLE IF NOT EXISTS "public"."integration_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "order_id" "uuid",
    "event" "text" NOT NULL,
    "payload" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."integration_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menu_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."menu_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."modifier_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "min_select" integer DEFAULT 0 NOT NULL,
    "max_select" integer DEFAULT 1 NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "modifier_groups_check" CHECK (("min_select" <= "max_select")),
    CONSTRAINT "modifier_groups_max_select_check" CHECK (("max_select" >= 1)),
    CONSTRAINT "modifier_groups_min_select_check" CHECK (("min_select" >= 0))
);


ALTER TABLE "public"."modifier_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."modifier_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "price_delta" numeric(10,2) DEFAULT 0 NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."modifier_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_item_modifiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "group_id" "uuid",
    "option_id" "uuid",
    "group_name" "text" NOT NULL,
    "option_name" "text" NOT NULL,
    "price_delta" numeric(10,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."order_item_modifiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_item_removed_ingredients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "ingredient_id" "uuid",
    "ingredient_name" "text" NOT NULL
);


ALTER TABLE "public"."order_item_removed_ingredients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "participant_id" "uuid",
    "is_shared" boolean DEFAULT false NOT NULL,
    "quantity" integer NOT NULL,
    "product_name" "text" NOT NULL,
    "base_price" numeric(10,2) NOT NULL,
    "total_price" numeric(10,2) NOT NULL,
    "notes" "text",
    CONSTRAINT "order_items_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_status_transitions" (
    "from_status" "public"."order_status" NOT NULL,
    "to_status" "public"."order_status" NOT NULL,
    "kind" "public"."order_transition_kind" NOT NULL
);


ALTER TABLE "public"."order_status_transitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_order_items" (
    "payment_id" "uuid" NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    CONSTRAINT "payment_order_items_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."payment_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "participant_id" "uuid",
    "amount" numeric(10,2) NOT NULL,
    "mode" "public"."payment_mode" NOT NULL,
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status" NOT NULL,
    "mp_payment_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "method" "public"."payment_method" NOT NULL,
    "external_reference" "text",
    CONSTRAINT "payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "payments_external_reference_length" CHECK ((("external_reference" IS NULL) OR ("length"("external_reference") <= 200)))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."payments"."mp_payment_id" IS 'Compatibilidad histórica. Las integraciones nuevas deben usar external_reference.';



COMMENT ON COLUMN "public"."payments"."method" IS 'Medio concreto usado para pagar. Es independiente de mode, que describe cómo se dividió la cuenta.';



COMMENT ON COLUMN "public"."payments"."external_reference" IS 'Identificador opcional del proveedor, transferencia, recibo o terminal. No contiene credenciales.';



CREATE TABLE IF NOT EXISTS "public"."pos_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "employee_id" "uuid",
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "order_id" "uuid",
    "session_id" "uuid",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_user_id" "uuid",
    "branch_id" "uuid"
);


ALTER TABLE "public"."pos_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_employees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "pin_hash" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "migrated_user_id" "uuid"
);


ALTER TABLE "public"."pos_employees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "type" "public"."pos_type" DEFAULT 'internal'::"public"."pos_type" NOT NULL,
    "credentials" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pos_integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."table_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "table_id" "uuid" NOT NULL,
    "status" "public"."session_status" DEFAULT 'open'::"public"."session_status" NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    "split_type" "public"."split_type" DEFAULT 'none'::"public"."split_type" NOT NULL,
    "split_allocations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "assigned_employee_id" "uuid",
    "bill_requested_at" timestamp with time zone,
    "in_person_payment_requested_at" timestamp with time zone,
    "assigned_user_id" "uuid",
    "bill_attended_at" timestamp with time zone,
    "in_person_payment_attended_at" timestamp with time zone,
    "split_equal_parts" smallint,
    "split_updated_by" "uuid",
    "split_updated_at" timestamp with time zone,
    CONSTRAINT "table_sessions_equal_parts_valid" CHECK (((("split_type" = 'equal'::"public"."split_type") AND (("split_equal_parts" >= 2) AND ("split_equal_parts" <= 50))) OR (("split_type" <> 'equal'::"public"."split_type") AND ("split_equal_parts" IS NULL))))
);


ALTER TABLE "public"."table_sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."table_sessions"."assigned_employee_id" IS 'Último empleado POS que operó una comanda de la sesión; se muestra como responsable actual.';



COMMENT ON COLUMN "public"."table_sessions"."bill_requested_at" IS 'Momento en que la mesa solicitó la cuenta. La acción del cliente se incorpora en MI-38.';



COMMENT ON COLUMN "public"."table_sessions"."in_person_payment_requested_at" IS 'Momento en que la mesa pidió cobro presencial. La acción del cliente se incorpora en MI-46.';



COMMENT ON COLUMN "public"."table_sessions"."bill_attended_at" IS 'Momento en que el salón dio por entregada la cuenta que la mesa pidió.';



COMMENT ON COLUMN "public"."table_sessions"."in_person_payment_attended_at" IS 'Momento en que el salón dio por cobrada la mesa en persona. El pago todavía no se registra como tal: eso llega con MI-49.';



COMMENT ON COLUMN "public"."table_sessions"."split_equal_parts" IS 'Cantidad de partes cuando split_type=equal; no depende de teléfonos conectados.';



COMMENT ON COLUMN "public"."table_sessions"."split_updated_by" IS 'Comensal (session_participants.id) que guardó la división vigente. Sin FK a propósito: ver la migración.';



COMMENT ON COLUMN "public"."table_sessions"."split_updated_at" IS 'Momento del último guardado de la división, aunque no haya cambiado ningún valor.';



CREATE OR REPLACE VIEW "public"."session_bills" WITH ("security_invoker"='true') AS
 SELECT "s"."id" AS "session_id",
    "s"."restaurant_id",
    COALESCE("o"."submitted_amount", (0)::numeric) AS "submitted_amount",
    COALESCE("o"."total_amount", (0)::numeric) AS "total_amount",
    COALESCE("p"."paid_amount", (0)::numeric) AS "paid_amount",
    GREATEST((COALESCE("o"."total_amount", (0)::numeric) - COALESCE("p"."paid_amount", (0)::numeric)), (0)::numeric) AS "pending_amount",
    ((COALESCE("o"."submitted_count", (0)::bigint) = 0) AND (COALESCE("o"."total_amount", (0)::numeric) > (0)::numeric) AND (COALESCE("p"."paid_amount", (0)::numeric) >= COALESCE("o"."total_amount", (0)::numeric))) AS "is_settled"
   FROM (("public"."table_sessions" "s"
     LEFT JOIN LATERAL ( SELECT "sum"("orders"."total_amount") FILTER (WHERE ("orders"."status" = 'submitted'::"public"."order_status")) AS "submitted_amount",
            "count"(*) FILTER (WHERE ("orders"."status" = 'submitted'::"public"."order_status")) AS "submitted_count",
            "sum"("orders"."total_amount") FILTER (WHERE ("orders"."status" = ANY (ARRAY['accepted'::"public"."order_status", 'in_preparation'::"public"."order_status", 'ready'::"public"."order_status", 'delivered'::"public"."order_status"]))) AS "total_amount"
           FROM "public"."orders"
          WHERE (("orders"."session_id" = "s"."id") AND ("orders"."restaurant_id" = "s"."restaurant_id"))) "o" ON (true))
     LEFT JOIN LATERAL ( SELECT "sum"("payments"."amount") AS "paid_amount"
           FROM "public"."payments"
          WHERE (("payments"."session_id" = "s"."id") AND ("payments"."restaurant_id" = "s"."restaurant_id") AND ("payments"."status" = 'approved'::"public"."payment_status"))) "p" ON (true))
  WHERE ("public"."is_session_participant"("s"."id") OR "public"."can_read_session"("s"."id", 'payments.read'::"text"));


ALTER VIEW "public"."session_bills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "named_at" timestamp with time zone
);


ALTER TABLE "public"."session_participants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."session_participants"."named_at" IS 'Momento en que el comensal eligió su nombre. Null mientras usa el que puso el sistema.';



CREATE TABLE IF NOT EXISTS "public"."tables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "qr_token" "text" DEFAULT "replace"(("gen_random_uuid"())::"text", '-'::"text", ''::"text") NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "section_id" "uuid",
    "position_x" integer DEFAULT 0 NOT NULL,
    "position_y" integer DEFAULT 0 NOT NULL,
    "seats" integer DEFAULT 4 NOT NULL,
    "shape" "text" DEFAULT 'rect'::"text" NOT NULL,
    "is_visible" boolean DEFAULT true NOT NULL,
    "width" integer DEFAULT 3 NOT NULL,
    "height" integer DEFAULT 3 NOT NULL,
    CONSTRAINT "tables_position_range" CHECK (((("position_x" >= 0) AND ("position_x" <= 99)) AND (("position_y" >= 0) AND ("position_y" <= 99)))),
    CONSTRAINT "tables_seats_range" CHECK ((("seats" >= 1) AND ("seats" <= 40))),
    CONSTRAINT "tables_shape_valid" CHECK (("shape" = ANY (ARRAY['rect'::"text", 'round'::"text"]))),
    CONSTRAINT "tables_span_range" CHECK (((("width" >= 1) AND ("width" <= 24)) AND (("height" >= 1) AND ("height" <= 24))))
);


ALTER TABLE "public"."tables" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tables"."shape" IS 'Solo estilo visual: rect (esquinas redondeadas) o round (elipse). El tamaño lo dan width y height.';



COMMENT ON COLUMN "public"."tables"."is_visible" IS 'La mesa se dibuja en el plano operativo. Una mesa oculta o inactiva no se puede operar desde el mapa.';



COMMENT ON COLUMN "public"."tables"."width" IS 'Ancho de la mesa en celdas de la grilla del plano (packages/shared/src/floor.ts).';



COMMENT ON COLUMN "public"."tables"."height" IS 'Alto de la mesa en celdas de la grilla del plano.';



CREATE OR REPLACE VIEW "public"."pos_open_sessions" WITH ("security_invoker"='true') AS
 SELECT "s"."id",
    "s"."restaurant_id",
    "s"."table_id",
    "s"."opened_at",
    "t"."label" AS "table_label",
    "t"."branch_id",
    "b"."name" AS "branch_name",
    COALESCE("p"."names", '{}'::"text"[]) AS "participant_names",
    COALESCE("bill"."submitted_amount", (0)::numeric) AS "submitted_amount",
    COALESCE("bill"."total_amount", (0)::numeric) AS "total_amount",
    COALESCE("bill"."paid_amount", (0)::numeric) AS "paid_amount",
    COALESCE("bill"."pending_amount", (0)::numeric) AS "pending_amount",
    "s"."bill_requested_at",
    "s"."bill_attended_at",
    "s"."in_person_payment_requested_at",
    "s"."in_person_payment_attended_at",
    "k"."tickets" AS "kitchen_tickets"
   FROM ((((("public"."table_sessions" "s"
     JOIN "public"."tables" "t" ON (("t"."id" = "s"."table_id")))
     JOIN "public"."branches" "b" ON (("b"."id" = "t"."branch_id")))
     LEFT JOIN "public"."session_bills" "bill" ON (("bill"."session_id" = "s"."id")))
     LEFT JOIN LATERAL ( SELECT "array_agg"("sp"."display_name" ORDER BY "sp"."joined_at") AS "names"
           FROM "public"."session_participants" "sp"
          WHERE ("sp"."session_id" = "s"."id")) "p" ON (true))
     LEFT JOIN LATERAL ( SELECT ("count"(*))::integer AS "tickets"
           FROM "public"."orders" "o"
          WHERE (("o"."session_id" = "s"."id") AND (EXISTS ( SELECT 1
                   FROM "public"."order_status_transitions" "tr"
                  WHERE (("tr"."from_status" = "o"."status") AND ("tr"."kind" = 'advance'::"public"."order_transition_kind")))))) "k" ON (true))
  WHERE ("s"."status" = 'open'::"public"."session_status");


ALTER VIEW "public"."pos_open_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pos_product_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "external_id" "text" NOT NULL
);


ALTER TABLE "public"."pos_product_mappings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_ingredients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_removable" boolean DEFAULT false NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."product_ingredients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_modifier_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."product_modifier_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "base_price" numeric(10,2) NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "dietary_tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "food_info" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "media_urls" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "products_base_price_check" CHECK (("base_price" >= (0)::numeric)),
    CONSTRAINT "products_media_urls_limit" CHECK (("cardinality"("media_urls") <= 3))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username_normalized" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_full_name_check" CHECK ((("length"("btrim"("full_name")) >= 1) AND ("length"("btrim"("full_name")) <= 100))),
    CONSTRAINT "valid_username" CHECK ((("username_normalized" = "lower"("btrim"("username_normalized"))) AND ("username_normalized" ~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$'::"text")))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurant_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."member_role" DEFAULT 'staff'::"public"."member_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "additional_roles" "public"."member_role"[] DEFAULT '{}'::"public"."member_role"[] NOT NULL,
    CONSTRAINT "operational_additional_roles" CHECK ((NOT ("additional_roles" && ARRAY['owner'::"public"."member_role", 'manager'::"public"."member_role"])))
);


ALTER TABLE "public"."restaurant_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "logo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "menu_design" "public"."menu_design" DEFAULT 'oliva'::"public"."menu_design" NOT NULL
);


ALTER TABLE "public"."restaurants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "role" "public"."member_role" NOT NULL,
    "permission" "text" NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."abandoned_order_requests"
    ADD CONSTRAINT "abandoned_order_requests_pkey" PRIMARY KEY ("participant_id", "request_id");



ALTER TABLE ONLY "public"."branch_memberships"
    ADD CONSTRAINT "branch_memberships_pkey" PRIMARY KEY ("membership_id", "branch_id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branch_restaurant_unique" UNIQUE ("id", "restaurant_id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");



ALTER TABLE ONLY "public"."floor_sections"
    ADD CONSTRAINT "floor_sections_branch_id_name_key" UNIQUE ("branch_id", "name");



ALTER TABLE ONLY "public"."floor_sections"
    ADD CONSTRAINT "floor_sections_id_branch_id_key" UNIQUE ("id", "branch_id");



ALTER TABLE ONLY "public"."floor_sections"
    ADD CONSTRAINT "floor_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_logs"
    ADD CONSTRAINT "integration_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_members"
    ADD CONSTRAINT "membership_restaurant_unique" UNIQUE ("id", "restaurant_id");



ALTER TABLE ONLY "public"."menu_categories"
    ADD CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_categories"
    ADD CONSTRAINT "menu_categories_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");



ALTER TABLE ONLY "public"."modifier_groups"
    ADD CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."modifier_groups"
    ADD CONSTRAINT "modifier_groups_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");



ALTER TABLE ONLY "public"."modifier_options"
    ADD CONSTRAINT "modifier_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_item_removed_ingredients"
    ADD CONSTRAINT "order_item_removed_ingredients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_status_transitions"
    ADD CONSTRAINT "order_status_transitions_pkey" PRIMARY KEY ("from_status", "to_status");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_participant_request_unique" UNIQUE ("submitted_by", "request_id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");



ALTER TABLE ONLY "public"."payment_order_items"
    ADD CONSTRAINT "payment_order_items_pkey" PRIMARY KEY ("payment_id", "order_item_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_audit_log"
    ADD CONSTRAINT "pos_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_employees"
    ADD CONSTRAINT "pos_employees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_employees"
    ADD CONSTRAINT "pos_employees_restaurant_id_full_name_key" UNIQUE ("restaurant_id", "full_name");



ALTER TABLE ONLY "public"."pos_integrations"
    ADD CONSTRAINT "pos_integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_integrations"
    ADD CONSTRAINT "pos_integrations_restaurant_id_key" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."pos_product_mappings"
    ADD CONSTRAINT "pos_product_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pos_product_mappings"
    ADD CONSTRAINT "pos_product_mappings_product_id_key" UNIQUE ("product_id");



ALTER TABLE ONLY "public"."product_ingredients"
    ADD CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_product_id_group_id_key" UNIQUE ("product_id", "group_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_normalized_key" UNIQUE ("username_normalized");



ALTER TABLE ONLY "public"."restaurant_members"
    ADD CONSTRAINT "restaurant_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_members"
    ADD CONSTRAINT "restaurant_members_restaurant_id_user_id_key" UNIQUE ("restaurant_id", "user_id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role", "permission");



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_session_id_user_id_key" UNIQUE ("session_id", "user_id");



ALTER TABLE ONLY "public"."table_sessions"
    ADD CONSTRAINT "table_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_sessions"
    ADD CONSTRAINT "table_sessions_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_label_unique_per_branch" UNIQUE ("branch_id", "label");



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_qr_token_key" UNIQUE ("qr_token");



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");



CREATE INDEX "branches_restaurant_id_idx" ON "public"."branches" USING "btree" ("restaurant_id");



CREATE INDEX "floor_sections_branch_id_sort_order_idx" ON "public"."floor_sections" USING "btree" ("branch_id", "sort_order");



CREATE INDEX "floor_sections_restaurant_id_idx" ON "public"."floor_sections" USING "btree" ("restaurant_id");



CREATE INDEX "integration_logs_restaurant_id_created_at_idx" ON "public"."integration_logs" USING "btree" ("restaurant_id", "created_at");



CREATE INDEX "menu_categories_restaurant_id_idx" ON "public"."menu_categories" USING "btree" ("restaurant_id");



CREATE INDEX "modifier_groups_restaurant_id_idx" ON "public"."modifier_groups" USING "btree" ("restaurant_id");



CREATE INDEX "modifier_options_group_id_idx" ON "public"."modifier_options" USING "btree" ("group_id");



CREATE INDEX "order_items_order_id_idx" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "orders_restaurant_created_idx" ON "public"."orders" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "orders_restaurant_id_status_idx" ON "public"."orders" USING "btree" ("restaurant_id", "status");



CREATE INDEX "orders_restaurant_local_date_idx" ON "public"."orders" USING "btree" ("restaurant_id", "local_date");



CREATE INDEX "orders_session_id_idx" ON "public"."orders" USING "btree" ("session_id");



CREATE INDEX "payment_order_items_order_item_id_idx" ON "public"."payment_order_items" USING "btree" ("order_item_id");



CREATE UNIQUE INDEX "payments_external_reference_unique" ON "public"."payments" USING "btree" ("restaurant_id", "method", "external_reference") WHERE ("external_reference" IS NOT NULL);



CREATE INDEX "payments_session_created_idx" ON "public"."payments" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "payments_session_id_idx" ON "public"."payments" USING "btree" ("session_id");



CREATE INDEX "pos_audit_log_restaurant_id_created_at_idx" ON "public"."pos_audit_log" USING "btree" ("restaurant_id", "created_at" DESC);



CREATE INDEX "pos_employees_restaurant_id_idx" ON "public"."pos_employees" USING "btree" ("restaurant_id") WHERE "is_active";



CREATE INDEX "product_ingredients_product_id_idx" ON "public"."product_ingredients" USING "btree" ("product_id");



CREATE INDEX "product_modifier_groups_product_id_idx" ON "public"."product_modifier_groups" USING "btree" ("product_id");



CREATE INDEX "products_restaurant_id_category_id_idx" ON "public"."products" USING "btree" ("restaurant_id", "category_id");



CREATE UNIQUE INDEX "profiles_username_case_insensitive" ON "public"."profiles" USING "btree" ("lower"("username_normalized"));



CREATE INDEX "session_participants_session_id_idx" ON "public"."session_participants" USING "btree" ("session_id");



CREATE INDEX "table_sessions_assigned_employee_idx" ON "public"."table_sessions" USING "btree" ("assigned_employee_id") WHERE (("status" = 'open'::"public"."session_status") AND ("assigned_employee_id" IS NOT NULL));



CREATE UNIQUE INDEX "table_sessions_one_open_per_table" ON "public"."table_sessions" USING "btree" ("table_id") WHERE ("status" = 'open'::"public"."session_status");



CREATE INDEX "table_sessions_restaurant_status_idx" ON "public"."table_sessions" USING "btree" ("restaurant_id", "status");



CREATE INDEX "table_sessions_table_id_idx" ON "public"."table_sessions" USING "btree" ("table_id");



CREATE INDEX "tables_branch_id_idx" ON "public"."tables" USING "btree" ("branch_id");



CREATE INDEX "tables_section_id_idx" ON "public"."tables" USING "btree" ("section_id");



CREATE OR REPLACE TRIGGER "orders_reject_abandoned_request" BEFORE INSERT ON "public"."orders" FOR EACH ROW WHEN (("new"."request_id" IS NOT NULL)) EXECUTE FUNCTION "public"."reject_abandoned_order_request"();



ALTER TABLE ONLY "public"."abandoned_order_requests"
    ADD CONSTRAINT "abandoned_order_requests_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."session_participants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."branch_memberships"
    ADD CONSTRAINT "branch_memberships_branch_id_restaurant_id_fkey" FOREIGN KEY ("branch_id", "restaurant_id") REFERENCES "public"."branches"("id", "restaurant_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."branch_memberships"
    ADD CONSTRAINT "branch_memberships_membership_id_restaurant_id_fkey" FOREIGN KEY ("membership_id", "restaurant_id") REFERENCES "public"."restaurant_members"("id", "restaurant_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."floor_sections"
    ADD CONSTRAINT "floor_sections_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."floor_sections"
    ADD CONSTRAINT "floor_sections_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_logs"
    ADD CONSTRAINT "integration_logs_order_id_fkey" FOREIGN KEY ("restaurant_id", "order_id") REFERENCES "public"."orders"("restaurant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_logs"
    ADD CONSTRAINT "integration_logs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_categories"
    ADD CONSTRAINT "menu_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."modifier_groups"
    ADD CONSTRAINT "modifier_groups_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."modifier_options"
    ADD CONSTRAINT "modifier_options_group_id_fkey" FOREIGN KEY ("restaurant_id", "group_id") REFERENCES "public"."modifier_groups"("restaurant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."modifier_options"
    ADD CONSTRAINT "modifier_options_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."modifier_options"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_item_removed_ingredients"
    ADD CONSTRAINT "order_item_removed_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "public"."product_ingredients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_item_removed_ingredients"
    ADD CONSTRAINT "order_item_removed_ingredients_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."session_participants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_session_id_fkey" FOREIGN KEY ("restaurant_id", "session_id") REFERENCES "public"."table_sessions"("restaurant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."session_participants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_order_items"
    ADD CONSTRAINT "payment_order_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_order_items"
    ADD CONSTRAINT "payment_order_items_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."session_participants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_session_id_fkey" FOREIGN KEY ("restaurant_id", "session_id") REFERENCES "public"."table_sessions"("restaurant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pos_audit_log"
    ADD CONSTRAINT "pos_audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pos_audit_log"
    ADD CONSTRAINT "pos_audit_log_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pos_audit_log"
    ADD CONSTRAINT "pos_audit_log_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."pos_employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pos_audit_log"
    ADD CONSTRAINT "pos_audit_log_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pos_audit_log"
    ADD CONSTRAINT "pos_audit_log_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pos_audit_log"
    ADD CONSTRAINT "pos_audit_log_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."table_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pos_audit_log"
    ADD CONSTRAINT "pos_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pos_employees"
    ADD CONSTRAINT "pos_employees_migrated_user_id_fkey" FOREIGN KEY ("migrated_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pos_employees"
    ADD CONSTRAINT "pos_employees_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pos_integrations"
    ADD CONSTRAINT "pos_integrations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pos_product_mappings"
    ADD CONSTRAINT "pos_product_mappings_product_id_fkey" FOREIGN KEY ("restaurant_id", "product_id") REFERENCES "public"."products"("restaurant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pos_product_mappings"
    ADD CONSTRAINT "pos_product_mappings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_ingredients"
    ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("restaurant_id", "product_id") REFERENCES "public"."products"("restaurant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_ingredients"
    ADD CONSTRAINT "product_ingredients_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_group_id_fkey" FOREIGN KEY ("restaurant_id", "group_id") REFERENCES "public"."modifier_groups"("restaurant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_product_id_fkey" FOREIGN KEY ("restaurant_id", "product_id") REFERENCES "public"."products"("restaurant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("restaurant_id", "category_id") REFERENCES "public"."menu_categories"("restaurant_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_members"
    ADD CONSTRAINT "restaurant_members_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_members"
    ADD CONSTRAINT "restaurant_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."table_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."table_sessions"
    ADD CONSTRAINT "table_sessions_assigned_employee_id_fkey" FOREIGN KEY ("assigned_employee_id") REFERENCES "public"."pos_employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."table_sessions"
    ADD CONSTRAINT "table_sessions_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."table_sessions"
    ADD CONSTRAINT "table_sessions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."table_sessions"
    ADD CONSTRAINT "table_sessions_table_id_fkey" FOREIGN KEY ("restaurant_id", "table_id") REFERENCES "public"."tables"("restaurant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_branch_id_fkey" FOREIGN KEY ("restaurant_id", "branch_id") REFERENCES "public"."branches"("restaurant_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_section_same_branch" FOREIGN KEY ("section_id", "branch_id") REFERENCES "public"."floor_sections"("id", "branch_id") ON DELETE SET NULL ("section_id");



ALTER TABLE "public"."abandoned_order_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admins manage pos integrations" ON "public"."pos_integrations" USING ("public"."is_restaurant_admin"("restaurant_id")) WITH CHECK ("public"."is_restaurant_admin"("restaurant_id"));



CREATE POLICY "admins manage pos mappings" ON "public"."pos_product_mappings" USING ("public"."is_restaurant_admin"("restaurant_id")) WITH CHECK ("public"."is_restaurant_admin"("restaurant_id"));



CREATE POLICY "admins read legacy employees" ON "public"."pos_employees" FOR SELECT TO "authenticated" USING ("public"."has_permission"("restaurant_id", 'employees.manage'::"text"));



CREATE POLICY "admins read pos audit" ON "public"."pos_audit_log" FOR SELECT TO "authenticated" USING ("public"."has_permission"("restaurant_id", 'audit.read'::"text"));



CREATE POLICY "admins update restaurant" ON "public"."restaurants" FOR UPDATE USING ("public"."is_restaurant_admin"("id"));



CREATE POLICY "admins write branches" ON "public"."branches" USING ("public"."is_restaurant_admin"("restaurant_id")) WITH CHECK ("public"."is_restaurant_admin"("restaurant_id"));



CREATE POLICY "admins write categories" ON "public"."menu_categories" USING ("public"."is_restaurant_admin"("restaurant_id")) WITH CHECK ("public"."is_restaurant_admin"("restaurant_id"));



CREATE POLICY "admins write floor sections" ON "public"."floor_sections" USING ("public"."is_restaurant_admin"("restaurant_id")) WITH CHECK ("public"."is_restaurant_admin"("restaurant_id"));



CREATE POLICY "admins write ingredients" ON "public"."product_ingredients" USING ("public"."is_restaurant_admin"("restaurant_id")) WITH CHECK ("public"."is_restaurant_admin"("restaurant_id"));



CREATE POLICY "admins write modifier groups" ON "public"."modifier_groups" USING ("public"."is_restaurant_admin"("restaurant_id")) WITH CHECK ("public"."is_restaurant_admin"("restaurant_id"));



CREATE POLICY "admins write modifier options" ON "public"."modifier_options" USING ("public"."is_restaurant_admin"("restaurant_id")) WITH CHECK ("public"."is_restaurant_admin"("restaurant_id"));



CREATE POLICY "admins write product modifier groups" ON "public"."product_modifier_groups" USING ("public"."is_restaurant_admin"("restaurant_id")) WITH CHECK ("public"."is_restaurant_admin"("restaurant_id"));



CREATE POLICY "admins write products" ON "public"."products" USING ("public"."is_restaurant_admin"("restaurant_id")) WITH CHECK ("public"."is_restaurant_admin"("restaurant_id"));



CREATE POLICY "admins write tables" ON "public"."tables" USING ("public"."is_restaurant_admin"("restaurant_id")) WITH CHECK ("public"."is_restaurant_admin"("restaurant_id"));



CREATE POLICY "authenticated read order status transitions" ON "public"."order_status_transitions" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."branch_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_scope" ON "public"."branches" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ("public"."employee_catalog_access"("restaurant_id", "id"));



CREATE POLICY "employee_scope" ON "public"."floor_sections" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ("public"."employee_catalog_access"("restaurant_id", "branch_id"));



CREATE POLICY "employee_scope" ON "public"."menu_categories" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ("public"."employee_catalog_access"("restaurant_id", NULL::"uuid"));



CREATE POLICY "employee_scope" ON "public"."modifier_groups" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ("public"."employee_catalog_access"("restaurant_id", NULL::"uuid"));



CREATE POLICY "employee_scope" ON "public"."modifier_options" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ("public"."employee_catalog_access"("restaurant_id", NULL::"uuid"));



CREATE POLICY "employee_scope" ON "public"."product_ingredients" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ("public"."employee_catalog_access"("restaurant_id", NULL::"uuid"));



CREATE POLICY "employee_scope" ON "public"."product_modifier_groups" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ("public"."employee_catalog_access"("restaurant_id", NULL::"uuid"));



CREATE POLICY "employee_scope" ON "public"."products" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ("public"."employee_catalog_access"("restaurant_id", NULL::"uuid"));



CREATE POLICY "employee_scope" ON "public"."restaurants" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ("public"."employee_catalog_access"("id"));



CREATE POLICY "employee_scope" ON "public"."tables" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ("public"."employee_catalog_access"("restaurant_id", "branch_id"));



ALTER TABLE "public"."floor_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "members read integration logs" ON "public"."integration_logs" FOR SELECT USING ("public"."is_restaurant_member"("restaurant_id"));



ALTER TABLE "public"."menu_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modifier_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modifier_options" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_item_modifiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_item_removed_ingredients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_status_transitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_product_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_ingredients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_modifier_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read assigned coworker" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."can_read_coworker"("id"));



CREATE POLICY "read branch assignments" ON "public"."branch_memberships" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."restaurant_members" "m"
  WHERE (("m"."id" = "branch_memberships"."membership_id") AND (("m"."user_id" = "auth"."uid"()) OR "public"."has_permission"("m"."restaurant_id", 'employees.manage'::"text"))))));



CREATE POLICY "read branches" ON "public"."branches" FOR SELECT USING (true);



CREATE POLICY "read categories" ON "public"."menu_categories" FOR SELECT USING (true);



CREATE POLICY "read floor sections" ON "public"."floor_sections" FOR SELECT USING (true);



CREATE POLICY "read ingredients" ON "public"."product_ingredients" FOR SELECT USING (true);



CREATE POLICY "read managed profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."restaurant_members" "m"
  WHERE (("m"."user_id" = "profiles"."id") AND "public"."has_permission"("m"."restaurant_id", 'employees.manage'::"text")))));



CREATE POLICY "read modifier groups" ON "public"."modifier_groups" FOR SELECT USING (true);



CREATE POLICY "read modifier options" ON "public"."modifier_options" FOR SELECT USING (true);



CREATE POLICY "read own or same-restaurant members" ON "public"."restaurant_members" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_restaurant_member"("restaurant_id")));



CREATE POLICY "read own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "read product modifier groups" ON "public"."product_modifier_groups" FOR SELECT USING (true);



CREATE POLICY "read products" ON "public"."products" FOR SELECT USING (true);



CREATE POLICY "read restaurants" ON "public"."restaurants" FOR SELECT USING (true);



CREATE POLICY "read tables" ON "public"."tables" FOR SELECT USING (true);



ALTER TABLE "public"."restaurant_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scoped read items" ON "public"."order_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE ("o"."id" = "order_items"."order_id"))));



CREATE POLICY "scoped read modifiers" ON "public"."order_item_modifiers" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."order_items" "i"
  WHERE ("i"."id" = "order_item_modifiers"."order_item_id"))));



CREATE POLICY "scoped read orders" ON "public"."orders" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."table_sessions" "s"
  WHERE (("s"."id" = "orders"."session_id") AND ("s"."restaurant_id" = "orders"."restaurant_id")))) AND ("public"."is_session_participant"("session_id") OR ("public"."can_read_session"("session_id") AND (("status" = ANY (ARRAY['submitted'::"public"."order_status", 'accepted'::"public"."order_status", 'in_preparation'::"public"."order_status", 'ready'::"public"."order_status"])) OR "public"."can_read_session"("session_id", 'history.read'::"text"))))));



CREATE POLICY "scoped read participants" ON "public"."session_participants" FOR SELECT USING (("public"."is_session_participant"("session_id") OR "public"."can_read_session"("session_id")));



CREATE POLICY "scoped read payments" ON "public"."payments" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."table_sessions" "s"
  WHERE (("s"."id" = "payments"."session_id") AND ("s"."restaurant_id" = "payments"."restaurant_id")))) AND ("public"."is_session_participant"("session_id") OR "public"."can_read_session"("session_id", 'payments.read'::"text"))));



CREATE POLICY "scoped read removed ingredients" ON "public"."order_item_removed_ingredients" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."order_items" "i"
  WHERE ("i"."id" = "order_item_removed_ingredients"."order_item_id"))));



CREATE POLICY "scoped read sessions" ON "public"."table_sessions" FOR SELECT USING (("public"."is_session_participant"("id") OR "public"."can_read_session"("id")));



CREATE POLICY "session participants and payment readers read payment items" ON "public"."payment_order_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."payments" "p"
  WHERE (("p"."id" = "payment_order_items"."payment_id") AND ("public"."is_session_participant"("p"."session_id") OR "public"."can_read_session"("p"."session_id", 'payments.read'::"text"))))));



ALTER TABLE "public"."session_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."table_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tables" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."abandon_order_request"("p_session_id" "uuid", "p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."abandon_order_request"("p_session_id" "uuid", "p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."abandon_order_request"("p_session_id" "uuid", "p_request_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_employee_password_reset"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid", "p_completed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_employee_password_reset"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid", "p_completed" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."authorize_employee_change"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid", "p_roles" "public"."member_role"[], "p_global" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."authorize_employee_change"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid", "p_roles" "public"."member_role"[], "p_global" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_media"("object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_media"("object_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_media"("object_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_read_coworker"("uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_read_coworker"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_coworker"("uid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_read_session"("sid" "uuid", "permission_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_read_session"("sid" "uuid", "permission_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_session"("sid" "uuid", "permission_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."close_table_session"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."close_table_session"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_table_session"("p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_mobile_payment"("p_session_id" "uuid", "p_request_id" "uuid", "p_mode" "public"."payment_mode", "p_item_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_mobile_payment"("p_session_id" "uuid", "p_request_id" "uuid", "p_mode" "public"."payment_mode", "p_item_ids" "uuid"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."create_mobile_payment"("p_session_id" "uuid", "p_request_id" "uuid", "p_mode" "public"."payment_mode", "p_item_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_restaurant"("p_name" "text", "p_slug" "text", "p_menu_design" "public"."menu_design", "p_branch_name" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_restaurant"("p_name" "text", "p_slug" "text", "p_menu_design" "public"."menu_design", "p_branch_name" "text", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_restaurant"("p_name" "text", "p_slug" "text", "p_menu_design" "public"."menu_design", "p_branch_name" "text", "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."customer_dispatch_internal_order"("p_order_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."customer_join_table_session"("qr" "text", "participant_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."delete_pos_employee"("p_restaurant_id" "uuid", "p_employee_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_pos_employee"("p_restaurant_id" "uuid", "p_employee_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."dispatch_internal_order"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dispatch_internal_order"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dispatch_internal_order"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."employee_catalog_access"("rid" "uuid", "bid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."employee_catalog_access"("rid" "uuid", "bid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."employee_catalog_access"("rid" "uuid", "bid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."employee_email_exists"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."employee_email_exists"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_order_pos_type"("p_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_order_pos_type"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_order_pos_type"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_pos_contexts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_pos_contexts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_pos_contexts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_permission"("rid" "uuid", "permission_name" "text", "bid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_permission"("rid" "uuid", "permission_name" "text", "bid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permission"("rid" "uuid", "permission_name" "text", "bid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_restaurant_admin"("rid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_restaurant_admin"("rid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_restaurant_admin"("rid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_restaurant_member"("rid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_restaurant_member"("rid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_restaurant_member"("rid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_session_participant"("sid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_session_participant"("sid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_session_participant"("sid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_table_session"("qr" "text", "participant_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_table_session"("qr" "text", "participant_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_table_session"("qr" "text", "participant_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_employee_accounts"("p_restaurant" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_employee_accounts"("p_restaurant" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_employee_accounts"("p_restaurant" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pos_close_table_session"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pos_close_table_session"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pos_close_table_session"("p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pos_move_table_session"("p_session_id" "uuid", "p_source_table_id" "uuid", "p_destination_table_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pos_move_table_session"("p_session_id" "uuid", "p_source_table_id" "uuid", "p_destination_table_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pos_move_table_session"("p_session_id" "uuid", "p_source_table_id" "uuid", "p_destination_table_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pos_open_table_session"("p_table_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pos_open_table_session"("p_table_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pos_open_table_session"("p_table_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pos_record_payment"("p_session_id" "uuid", "p_amount" numeric, "p_method" "public"."payment_method", "p_mode" "public"."payment_mode", "p_participant_id" "uuid", "p_external_reference" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pos_record_payment"("p_session_id" "uuid", "p_amount" numeric, "p_method" "public"."payment_method", "p_mode" "public"."payment_mode", "p_participant_id" "uuid", "p_external_reference" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pos_record_payment"("p_session_id" "uuid", "p_amount" numeric, "p_method" "public"."payment_method", "p_mode" "public"."payment_mode", "p_participant_id" "uuid", "p_external_reference" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pos_resolve_session_request"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pos_resolve_session_request"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pos_resolve_session_request"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pos_transition_order"("p_order_id" "uuid", "p_status" "public"."order_status") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pos_transition_order"("p_order_id" "uuid", "p_status" "public"."order_status") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pos_transition_order"("p_order_id" "uuid", "p_status" "public"."order_status") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_pos_action"("p_restaurant_id" "uuid", "p_branch_id" "uuid", "p_action" "text", "p_order_id" "uuid", "p_session_id" "uuid", "p_details" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_pos_action"("p_restaurant_id" "uuid", "p_branch_id" "uuid", "p_action" "text", "p_order_id" "uuid", "p_session_id" "uuid", "p_details" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reject_abandoned_order_request"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_abandoned_order_request"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reorder_categories"("p_restaurant_id" "uuid", "p_category_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_categories"("p_restaurant_id" "uuid", "p_category_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_categories"("p_restaurant_id" "uuid", "p_category_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_session_service"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_session_service"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_session_service"("p_session_id" "uuid", "p_kind" "public"."session_request_kind") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_mobile_payment"("p_payment_id" "uuid", "p_user_id" "uuid", "p_status" "public"."payment_status") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_mobile_payment"("p_payment_id" "uuid", "p_user_id" "uuid", "p_status" "public"."payment_status") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_employee_account"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid", "p_full_name" "text", "p_roles" "public"."member_role"[], "p_branches" "uuid"[], "p_active" boolean, "p_username" "text", "p_legacy" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_employee_account"("p_actor" "uuid", "p_restaurant" "uuid", "p_user" "uuid", "p_full_name" "text", "p_roles" "public"."member_role"[], "p_branches" "uuid"[], "p_active" boolean, "p_username" "text", "p_legacy" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_modifier_group"("p_restaurant_id" "uuid", "p_name" "text", "p_min_select" integer, "p_max_select" integer, "p_is_available" boolean, "p_options" "jsonb", "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_modifier_group"("p_restaurant_id" "uuid", "p_name" "text", "p_min_select" integer, "p_max_select" integer, "p_is_available" boolean, "p_options" "jsonb", "p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_modifier_group"("p_restaurant_id" "uuid", "p_name" "text", "p_min_select" integer, "p_max_select" integer, "p_is_available" boolean, "p_options" "jsonb", "p_group_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_product"("p_restaurant_id" "uuid", "p_category_id" "uuid", "p_name" "text", "p_base_price" numeric, "p_dietary_tags" "text"[], "p_is_available" boolean, "p_media_urls" "text"[], "p_ingredients" "jsonb", "p_group_ids" "uuid"[], "p_product_id" "uuid", "p_description" "text", "p_food_info" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_product"("p_restaurant_id" "uuid", "p_category_id" "uuid", "p_name" "text", "p_base_price" numeric, "p_dietary_tags" "text"[], "p_is_available" boolean, "p_media_urls" "text"[], "p_ingredients" "jsonb", "p_group_ids" "uuid"[], "p_product_id" "uuid", "p_description" "text", "p_food_info" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_product"("p_restaurant_id" "uuid", "p_category_id" "uuid", "p_name" "text", "p_base_price" numeric, "p_dietary_tags" "text"[], "p_is_available" boolean, "p_media_urls" "text"[], "p_ingredients" "jsonb", "p_group_ids" "uuid"[], "p_product_id" "uuid", "p_description" "text", "p_food_info" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."session_percentage_share"("p_session_id" "uuid", "p_participant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."session_percentage_share"("p_session_id" "uuid", "p_participant_id" "uuid") TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."orders" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_order"("p_session_id" "uuid", "p_request_id" "uuid", "p_items" "jsonb", "p_expected_total" numeric, "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_order"("p_session_id" "uuid", "p_request_id" "uuid", "p_items" "jsonb", "p_expected_total" numeric, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_order"("p_session_id" "uuid", "p_request_id" "uuid", "p_items" "jsonb", "p_expected_total" numeric, "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_status" "public"."order_status") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_status" "public"."order_status") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transition_order"("p_order_id" "uuid", "p_status" "public"."order_status") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_session_split"("p_session_id" "uuid", "p_split_type" "public"."split_type", "p_allocations" "jsonb", "p_equal_parts" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_session_split"("p_session_id" "uuid", "p_split_type" "public"."split_type", "p_allocations" "jsonb", "p_equal_parts" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_session_split"("p_session_id" "uuid", "p_split_type" "public"."split_type", "p_allocations" "jsonb", "p_equal_parts" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_pos_employee"("p_restaurant_id" "uuid", "p_full_name" "text", "p_pin" "text", "p_employee_id" "uuid", "p_is_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_pos_employee"("p_restaurant_id" "uuid", "p_full_name" "text", "p_pin" "text", "p_employee_id" "uuid", "p_is_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_pos_pin"("p_restaurant_id" "uuid", "p_pin" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_pos_pin"("p_restaurant_id" "uuid", "p_pin" "text") TO "service_role";



GRANT ALL ON TABLE "public"."abandoned_order_requests" TO "service_role";



GRANT ALL ON TABLE "public"."branch_memberships" TO "service_role";
GRANT SELECT ON TABLE "public"."branch_memberships" TO "authenticated";



GRANT ALL ON TABLE "public"."branches" TO "anon";
GRANT ALL ON TABLE "public"."branches" TO "authenticated";
GRANT ALL ON TABLE "public"."branches" TO "service_role";



GRANT ALL ON TABLE "public"."floor_sections" TO "anon";
GRANT ALL ON TABLE "public"."floor_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."floor_sections" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."integration_logs" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."integration_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."integration_logs" TO "service_role";



GRANT ALL ON TABLE "public"."menu_categories" TO "anon";
GRANT ALL ON TABLE "public"."menu_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_categories" TO "service_role";



GRANT ALL ON TABLE "public"."modifier_groups" TO "anon";
GRANT ALL ON TABLE "public"."modifier_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."modifier_groups" TO "service_role";



GRANT ALL ON TABLE "public"."modifier_options" TO "anon";
GRANT ALL ON TABLE "public"."modifier_options" TO "authenticated";
GRANT ALL ON TABLE "public"."modifier_options" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_item_modifiers" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_item_modifiers" TO "authenticated";
GRANT ALL ON TABLE "public"."order_item_modifiers" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_item_removed_ingredients" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_item_removed_ingredients" TO "authenticated";
GRANT ALL ON TABLE "public"."order_item_removed_ingredients" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_items" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."order_status_transitions" TO "authenticated";
GRANT ALL ON TABLE "public"."order_status_transitions" TO "service_role";



GRANT ALL ON TABLE "public"."payment_order_items" TO "service_role";
GRANT SELECT ON TABLE "public"."payment_order_items" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."pos_audit_log" TO "service_role";
GRANT SELECT ON TABLE "public"."pos_audit_log" TO "authenticated";



GRANT ALL ON TABLE "public"."pos_employees" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."pos_employees" TO "authenticated";



GRANT SELECT("restaurant_id") ON TABLE "public"."pos_employees" TO "authenticated";



GRANT SELECT("full_name") ON TABLE "public"."pos_employees" TO "authenticated";



GRANT SELECT("is_active") ON TABLE "public"."pos_employees" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."pos_employees" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."pos_employees" TO "authenticated";



GRANT SELECT("migrated_user_id") ON TABLE "public"."pos_employees" TO "authenticated";



GRANT ALL ON TABLE "public"."pos_integrations" TO "anon";
GRANT ALL ON TABLE "public"."pos_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_integrations" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."table_sessions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."table_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."table_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."session_bills" TO "authenticated";
GRANT ALL ON TABLE "public"."session_bills" TO "service_role";



GRANT ALL ON TABLE "public"."session_participants" TO "anon";
GRANT ALL ON TABLE "public"."session_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."session_participants" TO "service_role";



GRANT ALL ON TABLE "public"."tables" TO "anon";
GRANT ALL ON TABLE "public"."tables" TO "authenticated";
GRANT ALL ON TABLE "public"."tables" TO "service_role";



GRANT ALL ON TABLE "public"."pos_open_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_open_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."pos_product_mappings" TO "anon";
GRANT ALL ON TABLE "public"."pos_product_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."pos_product_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."product_ingredients" TO "anon";
GRANT ALL ON TABLE "public"."product_ingredients" TO "authenticated";
GRANT ALL ON TABLE "public"."product_ingredients" TO "service_role";



GRANT ALL ON TABLE "public"."product_modifier_groups" TO "anon";
GRANT ALL ON TABLE "public"."product_modifier_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."product_modifier_groups" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."restaurant_members" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."restaurant_members" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_members" TO "service_role";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."restaurants" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."restaurants" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurants" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








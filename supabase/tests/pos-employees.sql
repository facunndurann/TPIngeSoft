-- MI-61: separación entre administración y operación del POS.
-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.expect_error(stmt text, expected text)
returns void language plpgsql as $$
declare actual text;
begin
  begin
    execute stmt;
  exception when others then actual := sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'Expected %, got % (running %)', expected, coalesce(actual, 'success'), stmt;
  end if;
end;
$$;

-- Prueba la RLS de verdad: como rol authenticated, no como superusuario.
-- Un update bloqueado por RLS no falla: simplemente no toca ninguna fila, así
-- que la escritura solo cuenta si además afectó algo.
create function pg_temp.can_write_as(uid uuid, stmt text)
returns boolean language plpgsql as $$
declare affected integer;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  begin
    set local role authenticated;
    execute stmt;
    get diagnostics affected = row_count;
    reset role;
    return affected > 0;
  exception when others then
    reset role;
    return false;
  end;
end;
$$;

do $$
declare
  admin_user uuid := gen_random_uuid();
  staff_user uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  diner uuid := gen_random_uuid();
  restaurant uuid;
  other_restaurant uuid;
  branch uuid;
  dining_table uuid;
  sid uuid;
  participant uuid;
  category uuid;
  product uuid;
  v_order_id uuid;
  items jsonb;
  employee uuid;
  other_employee uuid;
  unlocked record;
  log_count integer;
begin
  insert into auth.users(id, aud, role) values
    (admin_user, 'authenticated', 'authenticated'),
    (staff_user, 'authenticated', 'authenticated'),
    (outsider, 'authenticated', 'authenticated'),
    (diner, 'authenticated', 'authenticated');
  insert into public.restaurants(name, slug) values('POS employees test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.restaurants(name, slug) values('POS employees other', gen_random_uuid()::text)
    returning id into other_restaurant;
  insert into public.restaurant_members(restaurant_id, user_id, role) values
    (restaurant, admin_user, 'owner'), (restaurant, staff_user, 'staff');
  insert into public.branches(restaurant_id, name) values(restaurant, 'Branch') returning id into branch;
  insert into public.tables(restaurant_id, branch_id, label) values(restaurant, branch, 'Table')
    returning id into dining_table;
  insert into public.table_sessions(restaurant_id, table_id) values(restaurant, dining_table)
    returning id into sid;
  insert into public.session_participants(session_id, user_id, display_name) values(sid, diner, 'Diner')
    returning id into participant;
  insert into public.menu_categories(restaurant_id, name) values(restaurant, 'Category')
    returning id into category;
  insert into public.products(restaurant_id, category_id, name, base_price)
    values(restaurant, category, 'Dish', 10) returning id into product;
  -- Solo tiene que existir y ser de otro restaurante: su PIN nunca se valida.
  insert into public.pos_employees(restaurant_id, full_name, pin_hash)
    values(other_restaurant, 'Ajeno', 'unused-hash')
    returning id into other_employee;
  items := jsonb_build_array(jsonb_build_object(
    'productId', product, 'quantity', 1, 'optionIds', '[]'::jsonb,
    'removedIds', '[]'::jsonb, 'isShared', false
  ));

  -- ---------- Alta de empleados: solo el administrador ----------
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_error(
    format('select public.upsert_pos_employee(%L, %L, %L)', restaurant, 'Ana', '1234'), 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', staff_user::text, true);
  perform pg_temp.expect_error(
    format('select public.upsert_pos_employee(%L, %L, %L)', restaurant, 'Ana', '1234'), 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_error(
    format('select public.upsert_pos_employee(%L, %L, %L)', restaurant, 'Ana', '1234'), 'FORBIDDEN');

  perform set_config('request.jwt.claim.sub', admin_user::text, true);
  perform pg_temp.expect_error(
    format('select public.upsert_pos_employee(%L, %L, %L)', restaurant, 'Ana', '12'), 'INVALID_PIN');
  perform pg_temp.expect_error(
    format('select public.upsert_pos_employee(%L, %L, %L)', restaurant, 'Ana', 'abcd'), 'INVALID_PIN');
  perform pg_temp.expect_error(
    format('select public.upsert_pos_employee(%L, %L)', restaurant, 'Ana'), 'INVALID_PIN');
  perform pg_temp.expect_error(
    format('select public.upsert_pos_employee(%L, %L, %L)', restaurant, '   ', '1234'), 'INVALID_REQUEST');

  employee := public.upsert_pos_employee(restaurant, 'Ana', '1234');
  if (select pin_hash from public.pos_employees where id = employee) = '1234' then
    raise exception 'PIN stored in clear text'; end if;

  -- Dos PIN iguales activos harían ambiguo el desbloqueo.
  perform pg_temp.expect_error(
    format('select public.upsert_pos_employee(%L, %L, %L)', restaurant, 'Beto', '1234'), 'PIN_TAKEN');
  perform pg_temp.expect_error(
    format('select public.upsert_pos_employee(%L, %L, %L)', restaurant, 'Ana', '4321'), 'NAME_TAKEN');
  perform pg_temp.expect_error(
    format('select public.upsert_pos_employee(%L, %L, %L, %L)', restaurant, 'Ana', '5678', gen_random_uuid()),
    'EMPLOYEE_NOT_FOUND');

  -- ---------- Validación de PIN ----------
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_error(
    format('select public.verify_pos_pin(%L, %L)', restaurant, '1234'), 'FORBIDDEN');

  -- Operar el POS es de cualquier miembro, no solo del administrador.
  perform set_config('request.jwt.claim.sub', staff_user::text, true);
  select * into unlocked from public.verify_pos_pin(restaurant, '1234');
  if unlocked.id <> employee or unlocked.full_name <> 'Ana' then
    raise exception 'Staff member could not unlock the POS with a valid PIN'; end if;
  perform pg_temp.expect_error(
    format('select public.verify_pos_pin(%L, %L)', restaurant, '0000'), 'INVALID_PIN');

  select count(*) into log_count from public.pos_audit_log
    where restaurant_id = restaurant and action = 'pos.unlocked' and employee_id = employee;
  if log_count <> 1 then raise exception 'Unlock was not audited'; end if;

  -- Un empleado dado de baja deja de poder operar.
  perform set_config('request.jwt.claim.sub', admin_user::text, true);
  perform public.upsert_pos_employee(restaurant, 'Ana', null, employee, false);
  perform pg_temp.expect_error(
    format('select public.verify_pos_pin(%L, %L)', restaurant, '1234'), 'INVALID_PIN');
  -- Reactivar conserva el PIN anterior (p_pin null no lo pisa).
  perform public.upsert_pos_employee(restaurant, 'Ana', null, employee, true);
  select * into unlocked from public.verify_pos_pin(restaurant, '1234');
  if unlocked.id <> employee then raise exception 'Reactivated employee lost its PIN'; end if;

  -- ---------- Operación auditada ----------
  perform set_config('request.jwt.claim.sub', diner::text, true);
  v_order_id := public.submit_order(sid, gen_random_uuid(), items, 10, null);

  perform set_config('request.jwt.claim.sub', staff_user::text, true);
  perform pg_temp.expect_error(
    format('select public.pos_transition_order(%L, %L, %L)', v_order_id, 'accepted', other_employee),
    'EMPLOYEE_NOT_FOUND');
  if (select status from public.orders where id = v_order_id) <> 'submitted' then
    raise exception 'A rejected audit must roll back the transition'; end if;

  if public.pos_transition_order(v_order_id, 'accepted', employee) <> v_order_id then
    raise exception 'Audited transition returned another order'; end if;
  if (select status from public.orders where id = v_order_id) <> 'accepted' then
    raise exception 'Audited transition did not apply'; end if;
  select count(*) into log_count from public.pos_audit_log
    where restaurant_id = restaurant and action = 'order.transition' and employee_id = employee
      and order_id = v_order_id and details->>'to' = 'accepted';
  if log_count <> 1 then raise exception 'Order transition was not audited'; end if;

  -- El operador queda registrado aun sin empleado (administrador sin altas).
  if public.pos_close_table_session(sid, null) <> sid then
    raise exception 'Audited close returned another session'; end if;
  if (select status from public.table_sessions where id = sid) <> 'closed' then
    raise exception 'Audited close did not apply'; end if;
  select count(*) into log_count from public.pos_audit_log
    where restaurant_id = restaurant and action = 'session.closed' and session_id = sid
      and employee_id is null and user_id = staff_user;
  if log_count <> 1 then raise exception 'Session close was not audited'; end if;

  -- Las validaciones originales siguen vigentes a través del envoltorio.
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform pg_temp.expect_error(
    format('select public.pos_close_table_session(%L, %L)', sid, employee), 'FORBIDDEN');
  perform pg_temp.expect_error(
    format('select public.pos_transition_order(%L, %L, %L)', gen_random_uuid(), 'ready', employee),
    'ORDER_NOT_FOUND');

  -- ---------- Administración sensible cerrada al usuario operativo ----------
  if pg_temp.can_write_as(staff_user, format(
    'insert into public.products(restaurant_id, category_id, name, base_price) values(%L, %L, %L, 1)',
    restaurant, category, 'Staff dish')) then
    raise exception 'Operative member can create products'; end if;
  if pg_temp.can_write_as(staff_user, format(
    'update public.products set base_price = 1 where id = %L', product)) then
    raise exception 'Operative member can change prices'; end if;
  if pg_temp.can_write_as(staff_user, format(
    'update public.menu_categories set name = %L where id = %L', 'Hacked', category)) then
    raise exception 'Operative member can edit categories'; end if;
  if pg_temp.can_write_as(staff_user, format(
    'insert into public.tables(restaurant_id, branch_id, label) values(%L, %L, %L)',
    restaurant, branch, 'Staff table')) then
    raise exception 'Operative member can edit tables'; end if;
  if pg_temp.can_write_as(staff_user, format(
    'update public.restaurants set name = %L where id = %L', 'Hacked', restaurant)) then
    raise exception 'Operative member can edit restaurant settings'; end if;

  -- El administrador conserva la administración.
  if not pg_temp.can_write_as(admin_user, format(
    'update public.products set base_price = 11 where id = %L', product)) then
    raise exception 'Administrator lost write access to products'; end if;

  -- ---------- Baja definitiva de empleados ----------
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_error(
    format('select public.delete_pos_employee(%L, %L)', restaurant, employee), 'AUTH_REQUIRED');
  perform set_config('request.jwt.claim.sub', staff_user::text, true);
  perform pg_temp.expect_error(
    format('select public.delete_pos_employee(%L, %L)', restaurant, employee), 'FORBIDDEN');
  perform set_config('request.jwt.claim.sub', admin_user::text, true);
  perform pg_temp.expect_error(
    format('select public.delete_pos_employee(%L, %L)', restaurant, other_employee),
    'EMPLOYEE_NOT_FOUND');

  if public.delete_pos_employee(restaurant, employee) <> employee then
    raise exception 'Employee deletion returned another employee'; end if;
  if exists(select 1 from public.pos_employees where id = employee) then
    raise exception 'Employee was not deleted'; end if;
  select count(*) into log_count from public.pos_audit_log
    where restaurant_id = restaurant and action = 'employee.deleted'
      and employee_id is null and details->>'employeeId' = employee::text
      and details->>'employeeName' = 'Ana';
  if log_count <> 1 then raise exception 'Employee deletion was not audited'; end if;
  if exists(
    select 1 from public.pos_audit_log
    where details->>'employeeId' = employee::text
      and details->>'employeeName' is distinct from 'Ana'
  ) then raise exception 'Deleted employee identity was not preserved in audit'; end if;

  -- ---------- Privilegios ----------
  if has_table_privilege('authenticated', 'public.pos_employees', 'INSERT')
    or has_table_privilege('authenticated', 'public.pos_employees', 'UPDATE')
    or has_table_privilege('authenticated', 'public.pos_employees', 'DELETE') then
    raise exception 'Authenticated role can bypass upsert_pos_employee'; end if;
  if has_column_privilege('authenticated', 'public.pos_employees', 'pin_hash', 'SELECT') then
    raise exception 'PIN hashes are readable through PostgREST'; end if;
  if not has_column_privilege('authenticated', 'public.pos_employees', 'full_name', 'SELECT') then
    raise exception 'POS cannot list its own employees'; end if;
  if has_table_privilege('authenticated', 'public.pos_audit_log', 'INSERT')
    or has_table_privilege('authenticated', 'public.pos_audit_log', 'UPDATE')
    or has_table_privilege('authenticated', 'public.pos_audit_log', 'DELETE') then
    raise exception 'Audit log can be written or erased by hand'; end if;
  if has_function_privilege('authenticated',
    'public.record_pos_action(uuid, uuid, text, uuid, uuid, jsonb)', 'EXECUTE') then
    raise exception 'Audit entries can be forged directly'; end if;
  if not has_function_privilege('authenticated',
    'public.delete_pos_employee(uuid, uuid)', 'EXECUTE') then
    raise exception 'Admin client cannot invoke employee deletion'; end if;

  raise notice 'POS employee SQL assertions passed (roles, PIN, audit, RLS, privileges)';
end;
$$;

rollback;

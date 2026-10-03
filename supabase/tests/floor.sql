-- MI-66: sectores y layout del salón.
-- Run with psql -v ON_ERROR_STOP=1 against a migrated local Supabase database.
-- Independent of seed; all fixtures and assertions are rolled back.
begin;

create function pg_temp.fails(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return true;
end;
$$;

-- Prueba la RLS de verdad: como rol authenticated, no como superusuario.
-- Un write bloqueado por RLS no siempre falla: un update sin filas visibles
-- simplemente no toca nada, así que solo cuenta si además afectó algo.
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
  restaurant uuid;
  branch uuid;
  other_branch uuid;
  section uuid;
  other_section uuid;
  dining_table uuid;
  hidden_table uuid;
  hidden_default uuid;
begin
  insert into auth.users(id, aud, role) values
    (admin_user, 'authenticated', 'authenticated'),
    (staff_user, 'authenticated', 'authenticated');
  insert into public.restaurants(name, slug) values('Floor test', gen_random_uuid()::text)
    returning id into restaurant;
  insert into public.restaurant_members(restaurant_id, user_id, role) values
    (restaurant, admin_user, 'owner'), (restaurant, staff_user, 'staff');
  insert into public.branches(restaurant_id, name) values(restaurant, 'Centro')
    returning id into branch;
  insert into public.branches(restaurant_id, name) values(restaurant, 'Norte')
    returning id into other_branch;

  insert into public.floor_sections(restaurant_id, branch_id, name)
    values(restaurant, branch, 'Salón') returning id into section;
  insert into public.floor_sections(restaurant_id, branch_id, name)
    values(restaurant, other_branch, 'Patio') returning id into other_section;

  -- ---------- Unicidad dentro del local ----------
  if not pg_temp.fails(format(
    'insert into public.floor_sections(restaurant_id, branch_id, name) values(%L, %L, %L)',
    restaurant, branch, 'Salón')) then
    raise exception 'Two sections with the same name in one branch'; end if;

  -- El mismo nombre en otra sucursal es válido.
  if pg_temp.fails(format(
    'insert into public.floor_sections(restaurant_id, branch_id, name) values(%L, %L, %L)',
    restaurant, other_branch, 'Salón')) then
    raise exception 'Section names must be reusable across branches'; end if;

  insert into public.tables(restaurant_id, branch_id, section_id, label, position_x, position_y)
    values(restaurant, branch, section, 'Mesa 1', 3, 4) returning id into dining_table;

  if not pg_temp.fails(format(
    'insert into public.tables(restaurant_id, branch_id, label) values(%L, %L, %L)',
    restaurant, branch, 'Mesa 1')) then
    raise exception 'Two tables with the same label in one branch'; end if;

  if pg_temp.fails(format(
    'insert into public.tables(restaurant_id, branch_id, label) values(%L, %L, %L)',
    restaurant, other_branch, 'Mesa 1')) then
    raise exception 'Table labels must be reusable across branches'; end if;

  -- ---------- El sector tiene que ser de la misma sucursal ----------
  if not pg_temp.fails(format(
    'update public.tables set section_id = %L where id = %L', other_section, dining_table)) then
    raise exception 'A table accepted a section from another branch'; end if;

  -- ---------- Validaciones de layout ----------
  if not pg_temp.fails(format(
    'update public.tables set seats = 0 where id = %L', dining_table)) then
    raise exception 'Capacity accepted zero seats'; end if;
  if not pg_temp.fails(format(
    'update public.tables set shape = %L where id = %L', 'triangle', dining_table)) then
    raise exception 'Unknown table shape accepted'; end if;
  -- 'square' y 'rectangle' dejaron de existir: el tamaño lo dan width y height.
  if not pg_temp.fails(format(
    'update public.tables set shape = %L where id = %L', 'square', dining_table)) then
    raise exception 'Legacy shape still accepted'; end if;
  if not pg_temp.fails(format(
    'update public.tables set width = 0 where id = %L', dining_table)) then
    raise exception 'Zero width accepted'; end if;
  if not pg_temp.fails(format(
    'update public.tables set height = 99 where id = %L', dining_table)) then
    raise exception 'Out-of-range height accepted'; end if;
  -- Entre los topes, cualquier combinación es válida: el tamaño es libre.
  if pg_temp.fails(format(
    'update public.tables set width = 9, height = 2 where id = %L', dining_table)) then
    raise exception 'A free width/height combination was rejected'; end if;
  -- El plano no tiene bordes: a la izquierda o arriba del origen también se
  -- puede. Solo un dato absurdo queda afuera.
  if pg_temp.fails(format(
    'update public.tables set position_x = -1, position_y = -6 where id = %L', dining_table)) then
    raise exception 'A position left of or above the origin was rejected'; end if;
  if not pg_temp.fails(format(
    'update public.tables set position_x = 10001 where id = %L', dining_table)) then
    raise exception 'Absurd position accepted'; end if;
  update public.tables set position_x = 3, position_y = 4 where id = dining_table;

  -- ---------- Valores por defecto y banderas ----------
  if (select position_x from public.tables where id = dining_table) <> 3
    or (select position_y from public.tables where id = dining_table) <> 4 then
    raise exception 'Layout position was not stored'; end if;
  if not (select is_visible from public.tables where id = dining_table) then
    raise exception 'Tables must be visible by default'; end if;
  insert into public.tables(restaurant_id, branch_id, section_id, label, is_visible)
    values(restaurant, branch, section, 'Barra', false) returning id into hidden_table;
  insert into public.tables(restaurant_id, branch_id, section_id, label)
    values(restaurant, branch, section, 'Mesa por defecto') returning id into hidden_default;
  if (select shape from public.tables where id = hidden_default) <> 'rect'
    or (select width from public.tables where id = hidden_default) <> 3
    or (select height from public.tables where id = hidden_default) <> 3 then
    raise exception 'New tables must default to a 3x3 rect'; end if;

  -- ---------- Borrar un sector no borra sus mesas ----------
  delete from public.floor_sections where id = section;
  if not exists (select 1 from public.tables where id = dining_table) then
    raise exception 'Deleting a section deleted its tables'; end if;
  if (select section_id from public.tables where id = dining_table) is not null then
    raise exception 'Deleting a section left a dangling reference'; end if;
  if (select branch_id from public.tables where id = dining_table) is null then
    raise exception 'Deleting a section cleared the branch'; end if;

  -- ---------- Solo el administrador configura el salón (MI-61) ----------
  if pg_temp.can_write_as(staff_user, format(
    'insert into public.floor_sections(restaurant_id, branch_id, name) values(%L, %L, %L)',
    restaurant, branch, 'Sector del operativo')) then
    raise exception 'Operative member can create sections'; end if;
  if pg_temp.can_write_as(staff_user, format(
    'update public.tables set position_x = 9 where id = %L', dining_table)) then
    raise exception 'Operative member can move tables'; end if;
  if pg_temp.can_write_as(staff_user, format(
    'update public.tables set is_visible = true where id = %L', hidden_table)) then
    raise exception 'Operative member can reveal hidden tables'; end if;

  if not pg_temp.can_write_as(admin_user, format(
    'update public.tables set position_x = 9 where id = %L', dining_table)) then
    raise exception 'Administrator cannot move tables'; end if;
  if not pg_temp.can_write_as(admin_user, format(
    'insert into public.floor_sections(restaurant_id, branch_id, name) values(%L, %L, %L)',
    restaurant, branch, 'Terraza')) then
    raise exception 'Administrator cannot create sections'; end if;

  raise notice 'Floor layout SQL assertions passed (sections, uniqueness, branch integrity, flags, RLS)';
end;
$$;

rollback;

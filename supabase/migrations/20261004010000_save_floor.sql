-- ============================================================
-- Guardar de una vez lo que se editó en el Salón.
--
-- El editor del plano dejó de escribir cada cambio al instante: arma un
-- borrador y lo guarda al final, o lo descarta. Lo que cambió (sectores y mesas
-- creados, modificados y borrados) se aplica en una sola transacción: queda todo
-- o no queda nada, y el POS nunca ve un salón a medio guardar.
--
-- Los nombres siguen siendo únicos por sucursal, pero se controlan al terminar
-- la transacción: así, intercambiar los nombres de dos mesas en una misma
-- edición no choca a mitad de camino.
-- ============================================================

alter table public.floor_sections
  drop constraint floor_sections_branch_id_name_key,
  add constraint floor_sections_branch_id_name_key unique (branch_id, name) deferrable initially immediate;

alter table public.tables
  drop constraint tables_label_unique_per_branch,
  add constraint tables_label_unique_per_branch unique (branch_id, label) deferrable initially immediate;

/*
 * p_changes:
 * {
 *   "sections": { "create": [{ id, name, sort_order, is_active }], "update": [{ id, ...lo que cambió }], "delete": [id] },
 *   "tables":   { "create": [{ id, label, section_id, position_x, position_y, width, height, seats, shape, is_active, is_visible }],
 *                 "update": [{ id, ...lo que cambió }], "delete": [id] }
 * }
 *
 * Los ids de lo nuevo los pone el editor, así una mesa nueva puede ir en un
 * sector nuevo. Una modificación trae solo las columnas que cambiaron: lo demás
 * de la fila (por ejemplo, lo que otra pantalla cambió mientras tanto) queda
 * como está. Solo se tocan filas de esta sucursal.
 */
create function public.save_floor(p_branch_id uuid, p_changes jsonb)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_restaurant uuid;
begin
  select restaurant_id into v_restaurant from public.branches where id = p_branch_id;
  if v_restaurant is null then raise exception 'BRANCH_NOT_FOUND'; end if;
  -- Con RLS, un update o un delete sin permiso no falla: no toca nada. Se dice antes.
  if not public.is_restaurant_admin(v_restaurant) then raise exception 'FORBIDDEN'; end if;

  set constraints floor_sections_branch_id_name_key, tables_label_unique_per_branch deferred;

  -- Sectores nuevos y modificados, antes que las mesas que los usan.
  insert into public.floor_sections(id, restaurant_id, branch_id, name, sort_order, is_active)
  select (s->>'id')::uuid, v_restaurant, p_branch_id, s->>'name',
         coalesce((s->>'sort_order')::integer, 0), coalesce((s->>'is_active')::boolean, true)
  from jsonb_array_elements(coalesce(p_changes->'sections'->'create', '[]')) s;

  update public.floor_sections f set
    name = case when s ? 'name' then s->>'name' else f.name end,
    sort_order = case when s ? 'sort_order' then (s->>'sort_order')::integer else f.sort_order end,
    is_active = case when s ? 'is_active' then (s->>'is_active')::boolean else f.is_active end
  from jsonb_array_elements(coalesce(p_changes->'sections'->'update', '[]')) s
  where f.id = (s->>'id')::uuid and f.branch_id = p_branch_id;

  delete from public.tables
  where branch_id = p_branch_id
    and id in (select (value)::uuid from jsonb_array_elements_text(coalesce(p_changes->'tables'->'delete', '[]')));

  insert into public.tables(
    id, restaurant_id, branch_id, label, section_id, position_x, position_y, width, height, seats, shape,
    is_active, is_visible
  )
  select (t->>'id')::uuid, v_restaurant, p_branch_id, t->>'label', (t->>'section_id')::uuid,
         (t->>'position_x')::integer, (t->>'position_y')::integer, (t->>'width')::integer, (t->>'height')::integer,
         (t->>'seats')::integer, t->>'shape', (t->>'is_active')::boolean, (t->>'is_visible')::boolean
  from jsonb_array_elements(coalesce(p_changes->'tables'->'create', '[]')) t;

  update public.tables m set
    label = case when t ? 'label' then t->>'label' else m.label end,
    section_id = case when t ? 'section_id' then (t->>'section_id')::uuid else m.section_id end,
    position_x = case when t ? 'position_x' then (t->>'position_x')::integer else m.position_x end,
    position_y = case when t ? 'position_y' then (t->>'position_y')::integer else m.position_y end,
    width = case when t ? 'width' then (t->>'width')::integer else m.width end,
    height = case when t ? 'height' then (t->>'height')::integer else m.height end,
    seats = case when t ? 'seats' then (t->>'seats')::integer else m.seats end,
    shape = case when t ? 'shape' then t->>'shape' else m.shape end,
    is_active = case when t ? 'is_active' then (t->>'is_active')::boolean else m.is_active end,
    is_visible = case when t ? 'is_visible' then (t->>'is_visible')::boolean else m.is_visible end
  from jsonb_array_elements(coalesce(p_changes->'tables'->'update', '[]')) t
  where m.id = (t->>'id')::uuid and m.branch_id = p_branch_id;

  -- Al final: sus mesas ya quedaron sin sector (o en otro) con las modificaciones.
  delete from public.floor_sections
  where branch_id = p_branch_id
    and id in (select (value)::uuid from jsonb_array_elements_text(coalesce(p_changes->'sections'->'delete', '[]')));

  -- Los nombres se controlan acá y no al confirmar la transacción: un nombre
  -- repetido hace fallar el guardado entero, también si quien llama sigue adentro
  -- de una transacción más larga.
  set constraints floor_sections_branch_id_name_key, tables_label_unique_per_branch immediate;
end;
$$;

revoke all on function public.save_floor(uuid, jsonb) from public, anon;
grant execute on function public.save_floor(uuid, jsonb) to authenticated;

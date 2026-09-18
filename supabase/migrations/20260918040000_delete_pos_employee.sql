-- ============================================================
-- MI-61: baja definitiva de empleados del POS.
--
-- La tabla no admite escrituras directas desde el cliente. La baja pasa por
-- esta RPC para validar al owner y conservar en la auditoría el nombre del
-- empleado antes de que la FK deje employee_id en null.
-- ============================================================

create or replace function public.delete_pos_employee(
  p_restaurant_id uuid,
  p_employee_id uuid
)
returns uuid
language plpgsql security definer set search_path = public
as $$
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

revoke all on function public.delete_pos_employee(uuid, uuid) from public, anon;
grant execute on function public.delete_pos_employee(uuid, uuid) to authenticated;

comment on function public.delete_pos_employee(uuid, uuid) is
  'Elimina un empleado POS y conserva su identidad en la auditoría; solo owner. Errores: AUTH_REQUIRED, INVALID_REQUEST, FORBIDDEN, EMPLOYEE_NOT_FOUND.';

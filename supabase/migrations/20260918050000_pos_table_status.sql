-- ============================================================
-- MI-63: estado operativo y datos clave de cada mesa.
--
-- La sesión es la fuente de verdad de la ocupación. Estos campos agregan solo
-- el contexto que no se puede deducir de pedidos/pagos: quién está atendiendo
-- y si el cliente pidió la cuenta o un cobro presencial.
-- ============================================================

alter table public.table_sessions
  add column assigned_employee_id uuid references public.pos_employees (id) on delete set null,
  add column bill_requested_at timestamptz,
  add column in_person_payment_requested_at timestamptz;

create index table_sessions_assigned_employee_idx
  on public.table_sessions (assigned_employee_id)
  where status = 'open' and assigned_employee_id is not null;

comment on column public.table_sessions.assigned_employee_id is
  'Último empleado POS que operó una comanda de la sesión; se muestra como responsable actual.';
comment on column public.table_sessions.bill_requested_at is
  'Momento en que la mesa solicitó la cuenta. La acción del cliente se incorpora en MI-38.';
comment on column public.table_sessions.in_person_payment_requested_at is
  'Momento en que la mesa pidió cobro presencial. La acción del cliente se incorpora en MI-46.';

-- Mantiene el contrato del envoltorio existente y, luego de validar/auditar al
-- operador, lo deja asignado a la sesión. Cualquier error revierte también la
-- transición realizada por transition_order.
create or replace function public.pos_transition_order(
  p_order_id uuid,
  p_status public.order_status,
  p_employee_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_restaurant uuid;
  v_session uuid;
  v_from public.order_status;
  v_id uuid;
begin
  select o.restaurant_id, o.session_id, o.status
    into v_restaurant, v_session, v_from
    from public.orders o where o.id = p_order_id;

  v_id := public.transition_order(p_order_id, p_status);

  perform public.record_pos_action(
    v_restaurant, p_employee_id, 'order.transition', p_order_id, v_session,
    jsonb_build_object('from', v_from, 'to', p_status));

  if p_employee_id is not null then
    update public.table_sessions
      set assigned_employee_id = p_employee_id
      where id = v_session and restaurant_id = v_restaurant;
  end if;

  return v_id;
end;
$$;

comment on function public.pos_transition_order(uuid, public.order_status, uuid) is
  'transition_order + auditoría y asignación del empleado a la sesión. Errores: los de transition_order más EMPLOYEE_NOT_FOUND.';

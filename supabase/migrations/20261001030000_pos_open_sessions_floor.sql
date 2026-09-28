-- ============================================================
-- Una sola lectura de las mesas abiertas para todo el POS.
--
-- Hasta acá el plano, la comanda y el traslado leían table_sessions con sus
-- pedidos y pagos embebidos, y aparte session_bills, y los juntaban en el
-- navegador; solo Mesas activas usaba esta vista. Para que la vista alcance a
-- todos le faltaba lo que el plano necesita para decidir el estado de la mesa:
-- quién la atiende, si hay un pago electrónico sin confirmar y en qué estado
-- está cada comanda de cocina.
--
-- Los importes dejan de pasar por coalesce: session_bills solo devuelve fila a
-- quien tiene payments.read (o a un comensal), y un importe que no se puede ver
-- es null, no 0. Antes un mozo leía «$ 0» en una mesa que debía plata.
--
-- Parte de la vista de 20261001020000_session_branch_and_order_authorship: la
-- sucursal sale de la cuenta, la mesa es opcional (una cuenta para llevar no
-- tiene) y `kind` dice cuál es cuál. El POS filtra por `kind = 'table'`.
-- ============================================================

drop view if exists public.pos_open_sessions;

create view public.pos_open_sessions with (security_invoker = true) as
select s.id, s.restaurant_id, s.table_id, s.opened_at,
  t.label as table_label,
  s.branch_id,
  b.name as branch_name,
  s.kind,
  coalesce(p.names, '{}') as participant_names,
  -- Left join a propósito: sin payments.read no hay fila de session_bills, la
  -- mesa se sigue viendo y sus importes quedan en null.
  bill.submitted_amount,
  bill.total_amount,
  bill.paid_amount,
  bill.pending_amount,
  s.bill_requested_at,
  s.bill_attended_at,
  s.in_person_payment_requested_at,
  s.in_person_payment_attended_at,
  k.tickets as kitchen_tickets,
  coalesce(k.statuses, '{}') as kitchen_statuses,
  -- Null si nadie la tiene asignada o si el perfil no es legible para quien consulta.
  e.full_name as assigned_employee_name,
  exists (
    select 1 from public.payments pay
    where pay.session_id = s.id
      and pay.restaurant_id = s.restaurant_id
      and pay.status = 'pending'
  ) as has_pending_payment
from public.table_sessions s
left join public.tables t on t.id = s.table_id
join public.branches b on b.id = s.branch_id
left join public.session_bills bill on bill.session_id = s.id
left join public.profiles e on e.id = s.assigned_user_id
left join lateral (
  select array_agg(sp.display_name order by sp.joined_at) as names
  from public.session_participants sp
  where sp.session_id = s.id
) p on true
-- Comandas de cocina: las que todavía pueden avanzar, igual que isKitchenTicket
-- en packages/shared. La cantidad y los estados salen de la misma lectura, así
-- que no pueden contradecirse.
left join lateral (
  select count(*)::integer as tickets,
    array_agg(o.status order by o.created_at) as statuses
  from public.orders o
  where o.session_id = s.id
    and exists (
      select 1 from public.order_status_transitions tr
      where tr.from_status = o.status and tr.kind = 'advance'
    )
) k on true
where s.status = 'open';

revoke all on public.pos_open_sessions from public, anon;
grant select on public.pos_open_sessions to authenticated;

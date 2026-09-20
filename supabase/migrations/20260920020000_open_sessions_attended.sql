-- ============================================================
-- Cobrar en la mesa no la cierra: cerrar es de caja/supervisión (`sessions.close`),
-- y el mozo que cobra no lo tiene. Para que esa mesa no quede colgada esperando
-- que alguien se acuerde, la vista de mesas activas expone también lo que ya se
-- atendió, y la pantalla la muestra como «Cobrada» junto al botón de cerrar.
--
-- Un cobro parcial tampoco debería cerrar la mesa (MI-49 reparte la cuenta entre
-- varios), así que la decisión sigue siendo de una persona.
-- ============================================================

drop view if exists public.pos_open_sessions;

create view public.pos_open_sessions with (security_invoker = true) as
select s.id, s.restaurant_id, s.table_id, s.opened_at,
  t.label as table_label,
  t.branch_id,
  b.name as branch_name,
  coalesce(p.names, '{}') as participant_names,
  coalesce(bill.submitted_amount, 0::numeric) as submitted_amount,
  coalesce(bill.total_amount, 0::numeric) as total_amount,
  coalesce(bill.paid_amount, 0::numeric) as paid_amount,
  coalesce(bill.pending_amount, 0::numeric) as pending_amount,
  s.bill_requested_at,
  s.bill_attended_at,
  s.in_person_payment_requested_at,
  s.in_person_payment_attended_at,
  k.tickets as kitchen_tickets
from public.table_sessions s
join public.tables t on t.id = s.table_id
join public.branches b on b.id = t.branch_id
-- Left join a propósito: session_bills solo devuelve fila a quien tiene
-- payments.read, y con un join interno un mozo no veía ninguna mesa activa.
left join public.session_bills bill on bill.session_id = s.id
left join lateral (
  select array_agg(sp.display_name order by sp.joined_at) as names
  from public.session_participants sp
  where sp.session_id = s.id
) p on true
left join lateral (
  select count(*)::integer as tickets
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

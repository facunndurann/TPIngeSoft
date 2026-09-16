-- Mesas activas del POS en una sola lectura.
--
-- El admin armaba cada tarjeta con tres queries: las sesiones abiertas, sus
-- cuentas (session_bills) y el tablero completo de pedidos, que traía solo para
-- contar las comandas en cocina. La vista devuelve una fila por sesión abierta.
--
-- security_invoker: el RLS de sesiones, pedidos, comensales y pagos se evalúa
-- con quien consulta, igual que en session_bills.
create view public.pos_open_sessions with (security_invoker = true) as
select s.id, s.restaurant_id, s.table_id, s.opened_at,
  t.label as table_label,
  b.name as branch_name,
  coalesce(p.names, '{}') as participant_names,
  bill.submitted_amount, bill.total_amount, bill.paid_amount, bill.pending_amount,
  k.tickets as kitchen_tickets
from public.table_sessions s
join public.tables t on t.id = s.table_id
join public.branches b on b.id = t.branch_id
join public.session_bills bill on bill.session_id = s.id
left join lateral (
  select array_agg(sp.display_name order by sp.joined_at) as names
  from public.session_participants sp
  where sp.session_id = s.id
) p on true
left join lateral (
  -- Un pedido sigue siendo comanda de cocina mientras su estado todavía puede
  -- avanzar; la regla sale de order_status_transitions, no de una lista fija.
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

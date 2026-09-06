-- Phase 5: restaurant members close table sessions through a locked RPC.
-- Browsers cannot write session status directly (same model as order transitions).
drop policy "members update sessions" on public.table_sessions;
revoke insert, update, delete on public.table_sessions from anon, authenticated;

create index if not exists table_sessions_restaurant_status_idx
  on public.table_sessions (restaurant_id, status);
create index if not exists orders_restaurant_created_idx
  on public.orders (restaurant_id, created_at desc);

create or replace function public.close_table_session(p_session_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.table_sessions;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_session_id is null then raise exception 'INVALID_REQUEST'; end if;

  -- Same table-then-session lock order as join_table_session and submit_order.
  perform 1 from public.tables t
    join public.table_sessions s on s.table_id = t.id
    where s.id = p_session_id
    for update of t;
  select * into target from public.table_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_restaurant_member(target.restaurant_id) then raise exception 'FORBIDDEN'; end if;
  if target.status = 'closed' then return target.id; end if;

  update public.table_sessions
    set status = 'closed', closed_at = now()
    where id = target.id;
  insert into public.integration_logs(restaurant_id, order_id, event, payload)
    values(
      target.restaurant_id,
      null,
      'session.closed',
      jsonb_build_object('sessionId', target.id, 'tableId', target.table_id, 'actorId', auth.uid())
    );
  return target.id;
end;
$$;

revoke all on function public.close_table_session(uuid) from public, anon;
grant execute on function public.close_table_session(uuid) to authenticated;

comment on function public.close_table_session(uuid) is
  'Tenant members close a table session. Idempotent if already closed. Errors: AUTH_REQUIRED, INVALID_REQUEST, SESSION_NOT_FOUND, FORBIDDEN.';

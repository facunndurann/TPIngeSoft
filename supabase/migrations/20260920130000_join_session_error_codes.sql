-- ============================================================
-- customer_join_table_session pasa a hablar con el catálogo compartido.
--
-- Era la única función del esquema que levantaba texto en inglés ('Table
-- unavailable', 'Authentication required'), y el cliente lo repropagaba crudo:
-- el comensal leía inglés en una app en español. Con los códigos de
-- packages/shared/src/errors.ts, el mensaje sale del catálogo como en el resto
-- del proyecto.
--
-- Solo cambian los `raise`: el cuerpo, los permisos y el envoltorio
-- join_table_session (que rechaza cuentas de empleado) quedan igual.
-- ============================================================

create or replace function public.customer_join_table_session(
  qr text,
  participant_name text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.tables;
  sid uuid;
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

  insert into public.session_participants(session_id, user_id, display_name)
    values(sid, auth.uid(), coalesce(trim(participant_name), 'Comensal'))
    on conflict (session_id, user_id) do update
      set display_name = coalesce(trim(participant_name), session_participants.display_name);

  return sid;
end;
$$;

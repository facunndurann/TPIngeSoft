-- ============================================================
-- Quién eligió su nombre y quién quedó con el que puso el sistema.
--
-- `display_name` arranca en 'Comensal' y no se puede distinguir de alguien que
-- lo escribió: con la cuenta dividida por comensal, la app necesita saberlo para
-- pedir el nombre antes del primer pedido y no volver a molestar después.
-- Comparar contra 'Comensal' no alcanza: dejaría encerrado a quien de verdad se
-- llame así, así que el dato se guarda.
-- ============================================================

alter table public.session_participants add column named_at timestamptz;

comment on column public.session_participants.named_at is
  'Momento en que el comensal eligió su nombre. Null mientras usa el que puso el sistema.';

-- Backfill: para las filas que ya existen, el único indicio es el nombre. Acá sí
-- sirve comparar contra el default, porque es una lectura única del pasado.
update public.session_participants set named_at = joined_at where display_name <> 'Comensal';

-- Misma firma que en 20260920130000: `create or replace` conserva sus permisos.
-- El cuerpo solo cambia en que el ingreso firma el nombre elegido.
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
  -- Null cuando el comensal entra sin nombre: no se puede dar por elegido el default.
  named timestamptz := case when participant_name is not null then now() end;
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

  insert into public.session_participants(session_id, user_id, display_name, named_at)
    values(sid, auth.uid(), coalesce(trim(participant_name), 'Comensal'), named)
    on conflict (session_id, user_id) do update
      set display_name = coalesce(trim(participant_name), session_participants.display_name),
          -- Volver a entrar sin nombre no borra el que ya se eligió.
          named_at = coalesce(named, session_participants.named_at);

  return sid;
end;
$$;

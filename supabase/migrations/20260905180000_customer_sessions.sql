-- Joining is atomic: lock the table so concurrent scans reuse one open session.
create or replace function public.join_table_session(qr text, participant_name text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.tables;
  sid uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if participant_name is not null and (length(trim(participant_name)) < 1 or length(trim(participant_name)) > 40) then
    raise exception 'Name must contain 1 to 40 characters';
  end if;
  select t.* into target from public.tables t
    join public.branches b on b.id = t.branch_id and b.restaurant_id = t.restaurant_id
    where t.qr_token = qr and t.is_active and b.is_active for update of t;
  if not found then raise exception 'Table unavailable'; end if;
  select id into sid from public.table_sessions where table_id = target.id and status = 'open' for update;
  if sid is null then
    insert into public.table_sessions(restaurant_id, table_id) values(target.restaurant_id, target.id) returning id into sid;
  end if;
  insert into public.session_participants(session_id, user_id, display_name)
    values(sid, auth.uid(), coalesce(trim(participant_name), 'Comensal'))
    on conflict (session_id, user_id) do update
      set display_name = coalesce(trim(participant_name), session_participants.display_name);
  return sid;
end;
$$;
revoke all on function public.join_table_session(text, text) from public, anon;
grant execute on function public.join_table_session(text, text) to authenticated;

-- All customer session writes go through the validated QR operation.
drop policy "authenticated open session" on public.table_sessions;
drop policy "join session as self" on public.session_participants;
drop policy "update own participant" on public.session_participants;
drop policy "read sessions" on public.table_sessions;
create policy "participants and members read sessions" on public.table_sessions for select using (
  public.is_session_participant(id) or public.is_restaurant_member(restaurant_id)
);
drop policy "read participants" on public.session_participants;
create policy "participants and members read participants" on public.session_participants for select using (
  public.is_session_participant(session_id) or exists (
    select 1 from public.table_sessions s where s.id = session_id and public.is_restaurant_member(s.restaurant_id)
  )
);

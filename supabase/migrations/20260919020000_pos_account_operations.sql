create function public.record_pos_action(
  p_restaurant_id uuid, p_branch_id uuid, p_action text,
  p_order_id uuid, p_session_id uuid, p_details jsonb default '{}'
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission(p_restaurant_id,'orders.read',p_branch_id)
    then raise exception 'FORBIDDEN'; end if;
  insert into pos_audit_log(restaurant_id,branch_id,actor_user_id,user_id,action,order_id,session_id,details)
    values(p_restaurant_id,p_branch_id,auth.uid(),auth.uid(),p_action,p_order_id,p_session_id,
      coalesce(p_details,'{}') || jsonb_build_object('actorName',(select full_name from profiles where id=auth.uid())));
end;
$$;
revoke all on function public.record_pos_action(uuid,uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;

create function public.pos_transition_order(p_order_id uuid, p_status public.order_status)
returns uuid language plpgsql security definer set search_path = public as $$
declare target public.orders; bid uuid; needed text; integration public.pos_integrations; reverting boolean;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Filter authorization before returning existence/state information or locking.
  select o.* into target from orders o where o.id=p_order_id
    and public.can_read_session(o.session_id) for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  select t.branch_id into bid from table_sessions s join tables t on t.id=s.table_id
    where s.id=target.session_id and t.restaurant_id=target.restaurant_id;
  needed := case
    when p_status='cancelled' then 'orders.cancel'
    when p_status < target.status then 'orders.revert'
    when p_status='accepted' then 'orders.accept'
    when p_status in ('in_preparation','ready') then 'orders.prepare'
    when p_status='delivered' then 'orders.deliver'
    else null end;
  if needed is null or bid is null or not exists(select 1 from profiles where id=auth.uid())
    or not public.has_permission(target.restaurant_id,needed,bid) then raise exception 'FORBIDDEN'; end if;
  if target.status=p_status then return target.id; end if;
  if (target.status,p_status) not in (values
    ('submitted'::public.order_status,'accepted'::public.order_status),
    ('accepted','in_preparation'),('in_preparation','ready'),('ready','delivered'),
    ('in_preparation','accepted'),('ready','in_preparation'),('delivered','ready'),
    ('submitted','cancelled'),('accepted','cancelled'),('in_preparation','cancelled'),('ready','cancelled')
  ) then raise exception 'INVALID_TRANSITION'; end if;
  if p_status='accepted' and target.status='submitted' then
    select * into integration from pos_integrations where restaurant_id=target.restaurant_id for share;
    if found then
      if not integration.is_active then raise exception 'POS_UNAVAILABLE'; end if;
      if integration.type <> 'internal' then raise exception 'POS_UNSUPPORTED'; end if;
    end if;
  end if;
  reverting := p_status < target.status;
  update orders set status=p_status,
    accepted_at=case when p_status='accepted' and not reverting then now() else accepted_at end,
    preparing_at=case when reverting and p_status<'in_preparation' then null
      when not reverting and p_status='in_preparation' then now() else preparing_at end,
    ready_at=case when reverting and p_status<'ready' then null
      when not reverting and p_status='ready' then now() else ready_at end,
    delivered_at=case when reverting then null when p_status='delivered' then now() else delivered_at end,
    cancelled_at=case when p_status='cancelled' then now() else cancelled_at end where id=target.id;
  update table_sessions set assigned_user_id=auth.uid() where id=target.session_id;
  perform public.record_pos_action(target.restaurant_id,bid,'order.transition',target.id,target.session_id,
    jsonb_build_object('from',target.status,'to',p_status));
  insert into integration_logs(restaurant_id,order_id,event,payload)
    values(target.restaurant_id,target.id,'order.status_changed',
      jsonb_build_object('from',target.status,'to',p_status,'actorId',auth.uid()));
  return target.id;
end;
$$;

create or replace function public.transition_order(p_order_id uuid,p_status public.order_status)
returns uuid language sql security definer set search_path = public as $$
  select public.pos_transition_order(p_order_id,p_status);
$$;

create function public.pos_close_table_session(p_session_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare target public.table_sessions; bid uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from profiles where id=auth.uid()) or
    not public.can_read_session(p_session_id,'sessions.close') then raise exception 'FORBIDDEN'; end if;
  -- Same table/session lock order as join/submit.
  perform 1 from tables t join table_sessions s on s.table_id=t.id where s.id=p_session_id for update of t;
  select * into target from table_sessions where id=p_session_id for update;
  select branch_id into bid from tables where id=target.table_id and restaurant_id=target.restaurant_id;
  if bid is null or not public.has_permission(target.restaurant_id,'sessions.close',bid) then raise exception 'FORBIDDEN'; end if;
  if target.status='closed' then return target.id; end if;
  update table_sessions set status='closed',closed_at=now() where id=target.id;
  perform public.record_pos_action(target.restaurant_id,bid,'session.closed',null,target.id);
  insert into integration_logs(restaurant_id,event,payload)
    values(target.restaurant_id,'session.closed',jsonb_build_object('sessionId',target.id,'actorId',auth.uid()));
  return target.id;
end;
$$;
create or replace function public.close_table_session(p_session_id uuid)
returns uuid language sql security definer set search_path = public as $$
  select public.pos_close_table_session(p_session_id);
$$;

-- Customer dispatch remains available to the actual submitter; employees must
-- use the audited permission-checked operation even through the old entry point.
alter function public.dispatch_internal_order(uuid) rename to customer_dispatch_internal_order;
revoke all on function public.customer_dispatch_internal_order(uuid) from public,anon,authenticated,service_role;
create function public.dispatch_internal_order(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from profiles where id=auth.uid()) then
    return public.pos_transition_order(p_order_id,'accepted');
  end if;
  if not exists(select 1 from orders o join session_participants p on p.id=o.submitted_by
    where o.id=p_order_id and p.user_id=auth.uid() and p.session_id=o.session_id)
    then raise exception 'FORBIDDEN'; end if;
  return public.customer_dispatch_internal_order(p_order_id);
end;
$$;
-- Avoid data/existence disclosure from the adapter lookup.
create or replace function public.get_order_pos_type(p_order_id uuid)
returns public.pos_type language plpgsql security definer set search_path = public as $$
declare target public.orders; integration public.pos_integrations;
begin
  select * into target from orders o where o.id=p_order_id and (
    public.can_read_session(o.session_id) or public.is_session_participant(o.session_id));
  if not found then raise exception 'FORBIDDEN'; end if;
  select * into integration from pos_integrations where restaurant_id=target.restaurant_id;
  if not found then return 'internal'; end if;
  if not integration.is_active then raise exception 'POS_UNAVAILABLE'; end if;
  return integration.type;
end;
$$;

-- Employee accounts cannot acquire customer privileges by joining a foreign QR.
alter function public.join_table_session(text,text) rename to customer_join_table_session;
revoke all on function public.customer_join_table_session(text,text) from public,anon,authenticated,service_role;
create function public.join_table_session(qr text,participant_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from profiles where id=auth.uid()) then raise exception 'FORBIDDEN'; end if;
  return public.customer_join_table_session(qr,participant_name);
end;
$$;
revoke all on function public.pos_transition_order(uuid,public.order_status),
  public.pos_close_table_session(uuid),public.dispatch_internal_order(uuid),public.join_table_session(text,text)
  from public,anon;
grant execute on function public.pos_transition_order(uuid,public.order_status),
  public.pos_close_table_session(uuid),public.dispatch_internal_order(uuid),public.join_table_session(text,text)
  to authenticated;

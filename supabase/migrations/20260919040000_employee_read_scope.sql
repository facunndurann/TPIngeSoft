-- The assigned operator can be shown to coworkers in a shared authorized branch.
create function public.can_read_coworker(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from restaurant_members m
    join branch_memberships bm on bm.membership_id=m.id
    where m.user_id=uid and m.is_active and public.has_permission(m.restaurant_id,'floor.read',bm.branch_id));
$$;
revoke all on function public.can_read_coworker(uuid) from public,anon;
grant execute on function public.can_read_coworker(uuid) to authenticated;
create policy "read assigned coworker" on public.profiles for select to authenticated using(public.can_read_coworker(id));

drop policy "scoped read orders" on public.orders;
create policy "scoped read orders" on public.orders for select using (
  exists(select 1 from public.table_sessions s where s.id=session_id and s.restaurant_id=orders.restaurant_id)
  and (public.is_session_participant(session_id) or (
    public.can_read_session(session_id) and (status in ('submitted','accepted','in_preparation','ready')
      or public.can_read_session(session_id,'history.read'))
  ))
);

drop policy "scoped read payments" on public.payments;
create policy "scoped read payments" on public.payments for select using (
  exists(select 1 from public.table_sessions s where s.id=session_id and s.restaurant_id=payments.restaurant_id)
  and (public.is_session_participant(session_id) or public.can_read_session(session_id,'payments.read'))
);

-- Financial aggregates require the same permission as their underlying payments.
create or replace view public.session_bills with (security_invoker = true) as
select s.id as session_id,s.restaurant_id,
  coalesce(o.submitted_amount,0::numeric) as submitted_amount,
  coalesce(o.total_amount,0::numeric) as total_amount,
  coalesce(p.paid_amount,0::numeric) as paid_amount,
  greatest(coalesce(o.total_amount,0::numeric)-coalesce(p.paid_amount,0::numeric),0::numeric) as pending_amount,
  (coalesce(o.submitted_count,0)=0 and coalesce(o.total_amount,0::numeric)>0
    and coalesce(p.paid_amount,0::numeric)>=coalesce(o.total_amount,0::numeric)) as is_settled
from public.table_sessions s
left join lateral (
  select sum(total_amount) filter(where status='submitted') as submitted_amount,
    count(*) filter(where status='submitted') as submitted_count,
    sum(total_amount) filter(where status in ('accepted','in_preparation','ready','delivered')) as total_amount
    from public.orders where session_id=s.id and restaurant_id=s.restaurant_id
) o on true
left join lateral (
  select sum(amount) as paid_amount from public.payments
    where session_id=s.id and restaurant_id=s.restaurant_id and status='approved'
) p on true
where public.is_session_participant(s.id) or public.can_read_session(s.id,'payments.read');

-- Storage writes must follow restaurant scope, including managers. Paths use rid/...
drop policy "admins write product images" on storage.objects;
drop policy "admins update product images" on storage.objects;
drop policy "admins delete product images" on storage.objects;
create function public.can_manage_media(object_name text)
returns boolean language plpgsql stable security definer set search_path=public as $$
begin
  return public.is_restaurant_admin(split_part(object_name,'/',1)::uuid);
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.can_manage_media(text) from public,anon;
grant execute on function public.can_manage_media(text) to authenticated;
create policy "admins write product images" on storage.objects for insert to authenticated
with check(bucket_id='product-images' and public.can_manage_media(name));
create policy "admins update product images" on storage.objects for update to authenticated
using(bucket_id='product-images' and public.can_manage_media(name))
with check(bucket_id='product-images' and public.can_manage_media(name));
create policy "admins delete product images" on storage.objects for delete to authenticated
using(bucket_id='product-images' and public.can_manage_media(name));

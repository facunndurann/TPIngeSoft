-- Dos altas simultáneas con el mismo username hacen que GoTrue pierda la carrera
-- de su chequeo previo: el índice único de auth.users aflora como un 500 opaco
-- ("Database error creating new user") en vez del 422 "already registered".
-- Esto deja distinguir esa colisión de una falla real de base sin volver a
-- llamar a la Admin API, que es una operación con efectos.
create function public.employee_email_exists(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from auth.users where lower(email) = lower(btrim(p_email)));
$$;
revoke all on function public.employee_email_exists(text) from public, anon, authenticated;
grant execute on function public.employee_email_exists(text) to service_role;

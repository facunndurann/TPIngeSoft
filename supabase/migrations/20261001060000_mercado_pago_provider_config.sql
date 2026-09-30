-- Sprint 3, fase 3: una cuenta receptora de Mercado Pago por restaurante,
-- asociada explícitamente a las sucursales donde puede usarse. Los secretos
-- quedan cifrados en Vault; las apps solo reciben estado y una máscara.

create extension if not exists supabase_vault with schema vault;

create type public.payment_provider as enum ('mercado_pago');
create type public.payment_provider_environment as enum ('test', 'production');

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table private.payment_provider_credentials (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  provider public.payment_provider not null,
  environment public.payment_provider_environment not null default 'test',
  access_token_secret_id uuid not null unique,
  access_token_hint text not null check (access_token_hint ~ '^.{4,12}$'),
  webhook_secret_id uuid unique,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, provider)
);

create table private.payment_provider_branches (
  restaurant_id uuid not null,
  branch_id uuid not null,
  provider public.payment_provider not null,
  created_at timestamptz not null default now(),
  primary key (branch_id, provider),
  foreign key (restaurant_id, provider)
    references private.payment_provider_credentials(restaurant_id, provider) on delete cascade,
  foreign key (restaurant_id, branch_id)
    references public.branches(restaurant_id, id) on delete cascade
);

revoke all on private.payment_provider_credentials, private.payment_provider_branches
  from public, anon, authenticated;
grant all on private.payment_provider_credentials, private.payment_provider_branches to service_role;

comment on table private.payment_provider_credentials is
  'Configuración privada por restaurante. Los valores secretos viven cifrados en Supabase Vault.';
comment on table private.payment_provider_branches is
  'Asociación explícita de la cuenta receptora con las sucursales donde puede iniciar pagos.';

-- El panel nunca lee las tablas privadas. Esta RPC entrega exactamente el estado
-- administrativo necesario y ninguna credencial.
create function public.get_payment_provider_config(p_restaurant_id uuid)
returns table(
  provider public.payment_provider,
  environment public.payment_provider_environment,
  configured boolean,
  access_token_hint text,
  webhook_configured boolean,
  branch_ids uuid[],
  updated_at timestamptz
)
language plpgsql stable security definer
set search_path = public, private
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission(p_restaurant_id, 'admin.manage') then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    'mercado_pago'::public.payment_provider,
    coalesce(c.environment, 'test'::public.payment_provider_environment),
    c.restaurant_id is not null,
    c.access_token_hint,
    c.webhook_secret_id is not null,
    coalesce(array_agg(pb.branch_id order by pb.branch_id)
      filter (where pb.branch_id is not null), '{}'::uuid[]),
    c.updated_at
  from (select 1) seed
  left join private.payment_provider_credentials c
    on c.restaurant_id = p_restaurant_id and c.provider = 'mercado_pago'
  left join private.payment_provider_branches pb
    on pb.restaurant_id = c.restaurant_id and pb.provider = c.provider
  group by c.restaurant_id, c.environment, c.access_token_hint,
    c.webhook_secret_id, c.updated_at;
end;
$$;

-- Un valor NULL conserva el secreto existente. Al configurar por primera vez el
-- access token es obligatorio; cambiar de ambiente exige reemplazarlo para no
-- reutilizar por accidente una credencial de pruebas en producción o viceversa.
create function public.save_payment_provider_config(
  p_restaurant_id uuid,
  p_environment public.payment_provider_environment,
  p_branch_ids uuid[],
  p_access_token text default null,
  p_webhook_secret text default null
)
returns void
language plpgsql security definer
set search_path = public, private, vault
as $$
declare
  saved private.payment_provider_credentials;
  access_secret_id uuid;
  new_webhook_secret_id uuid;
  access_value text := nullif(btrim(p_access_token), '');
  webhook_value text := nullif(btrim(p_webhook_secret), '');
  access_name text := 'payment-provider:' || p_restaurant_id::text || ':mercado-pago:access-token';
  webhook_name text := 'payment-provider:' || p_restaurant_id::text || ':mercado-pago:webhook-secret';
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission(p_restaurant_id, 'admin.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if p_environment is null or p_branch_ids is null
    or array_position(p_branch_ids, null) is not null
    or cardinality(p_branch_ids) <> (
      select count(distinct requested.branch_id)
      from unnest(p_branch_ids) as requested(branch_id)
    )
    or exists (
      select 1 from unnest(p_branch_ids) as requested(branch_id)
      where not exists (
        select 1 from public.branches b
        where b.id = requested.branch_id and b.restaurant_id = p_restaurant_id
      )
    ) then
    raise exception 'INVALID_REQUEST';
  end if;
  if access_value is not null and (
    length(access_value) < 20 or length(access_value) > 512 or access_value ~ '[[:space:]]'
  ) then raise exception 'INVALID_REQUEST'; end if;
  if webhook_value is not null and (
    length(webhook_value) < 16 or length(webhook_value) > 512 or webhook_value ~ '[[:space:]]'
  ) then raise exception 'INVALID_REQUEST'; end if;

  select * into saved
  from private.payment_provider_credentials
  where restaurant_id = p_restaurant_id and provider = 'mercado_pago'
  for update;

  if saved.restaurant_id is null then
    if access_value is null then raise exception 'INVALID_REQUEST'; end if;
    access_secret_id := vault.create_secret(
      access_value,
      access_name,
      'Mercado Pago access token for restaurant ' || p_restaurant_id::text
    );
    if webhook_value is not null then
      new_webhook_secret_id := vault.create_secret(
        webhook_value,
        webhook_name,
        'Mercado Pago webhook secret for restaurant ' || p_restaurant_id::text
      );
    end if;
    insert into private.payment_provider_credentials(
      restaurant_id, provider, environment, access_token_secret_id,
      access_token_hint, webhook_secret_id, updated_by
    ) values (
      p_restaurant_id, 'mercado_pago', p_environment, access_secret_id,
      right(access_value, 4), new_webhook_secret_id, auth.uid()
    );
  else
    if saved.environment <> p_environment and access_value is null then
      raise exception 'INVALID_REQUEST';
    end if;
    if access_value is not null then
      perform vault.update_secret(saved.access_token_secret_id, access_value);
    end if;
    if webhook_value is not null then
      if saved.webhook_secret_id is null then
        new_webhook_secret_id := vault.create_secret(
          webhook_value,
          webhook_name,
          'Mercado Pago webhook secret for restaurant ' || p_restaurant_id::text
        );
      else
        new_webhook_secret_id := saved.webhook_secret_id;
        perform vault.update_secret(new_webhook_secret_id, webhook_value);
      end if;
    else
      new_webhook_secret_id := saved.webhook_secret_id;
    end if;
    update private.payment_provider_credentials set
      environment = p_environment,
      access_token_hint = case when access_value is null then saved.access_token_hint
        else right(access_value, 4) end,
      webhook_secret_id = new_webhook_secret_id,
      updated_by = auth.uid(),
      updated_at = now()
    where restaurant_id = p_restaurant_id and provider = 'mercado_pago';
  end if;

  delete from private.payment_provider_branches
  where restaurant_id = p_restaurant_id and provider = 'mercado_pago';
  insert into private.payment_provider_branches(restaurant_id, branch_id, provider)
    select p_restaurant_id, requested.branch_id, 'mercado_pago'
    from unnest(p_branch_ids) as requested(branch_id);
end;
$$;

create function public.delete_payment_provider_config(p_restaurant_id uuid)
returns void
language plpgsql security definer
set search_path = public, private, vault
as $$
declare saved private.payment_provider_credentials;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission(p_restaurant_id, 'admin.manage') then
    raise exception 'FORBIDDEN';
  end if;
  select * into saved from private.payment_provider_credentials
    where restaurant_id = p_restaurant_id and provider = 'mercado_pago'
    for update;
  if saved.restaurant_id is null then return; end if;

  delete from private.payment_provider_credentials
    where restaurant_id = p_restaurant_id and provider = 'mercado_pago';
  delete from vault.secrets where id in (
    saved.access_token_secret_id, saved.webhook_secret_id
  );
end;
$$;

-- Una eliminación del restaurante también limpia de Vault los secretos que la FK
-- borra de la tabla privada.
create function private.delete_payment_provider_vault_secrets()
returns trigger language plpgsql security definer
set search_path = private, vault
as $$
begin
  delete from vault.secrets where id in (
    old.access_token_secret_id, old.webhook_secret_id
  );
  return old;
end;
$$;
create trigger payment_provider_credentials_delete_secrets
after delete on private.payment_provider_credentials
for each row execute function private.delete_payment_provider_vault_secrets();

-- Es la única información del proveedor que necesita customer. La membresía en
-- la cuenta se verifica antes de responder y no se exponen ambiente, asociación,
-- máscara ni secretos.
create function public.mobile_payment_available(p_session_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, private
as $$
declare available boolean;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_session_participant(p_session_id) then
    raise exception 'NOT_PARTICIPANT';
  end if;
  select exists (
    select 1
    from public.table_sessions s
    join public.branches b
      on b.id = s.branch_id and b.restaurant_id = s.restaurant_id
    join private.payment_provider_credentials c
      on c.restaurant_id = s.restaurant_id and c.provider = 'mercado_pago'
    join private.payment_provider_branches pb
      on pb.restaurant_id = s.restaurant_id and pb.branch_id = s.branch_id
      and pb.provider = c.provider
    where s.id = p_session_id and s.status = 'open' and b.is_active
      and 'mobile' = any(b.payment_methods)
  ) into available;
  return available;
end;
$$;

-- Contrato para la Edge Function de fase 4. Solo service_role puede obtener las
-- credenciales descifradas y el receptor efectivo de una cuenta.
create function public.resolve_payment_provider_for_session(p_session_id uuid)
returns table(
  provider public.payment_provider,
  environment public.payment_provider_environment,
  access_token text,
  webhook_secret text,
  restaurant_id uuid,
  branch_id uuid
)
language sql stable security definer
set search_path = public, private, vault
as $$
  select c.provider, c.environment, access.decrypted_secret,
    webhook.decrypted_secret, s.restaurant_id, s.branch_id
  from public.table_sessions s
  join public.branches b
    on b.id = s.branch_id and b.restaurant_id = s.restaurant_id
  join private.payment_provider_credentials c
    on c.restaurant_id = s.restaurant_id and c.provider = 'mercado_pago'
  join private.payment_provider_branches pb
    on pb.restaurant_id = s.restaurant_id and pb.branch_id = s.branch_id
    and pb.provider = c.provider
  join vault.decrypted_secrets access on access.id = c.access_token_secret_id
  left join vault.decrypted_secrets webhook on webhook.id = c.webhook_secret_id
  where s.id = p_session_id and s.status = 'open' and b.is_active
    and 'mobile' = any(b.payment_methods);
$$;

-- La validación vive en INSERT: apagar el medio, quitar la asociación o borrar
-- la configuración impide intentos nuevos, pero no bloquea UPDATE/webhook sobre
-- un pago pendiente que ya existía.
create function private.require_mobile_payment_provider()
returns trigger language plpgsql security definer
set search_path = public, private
as $$
begin
  -- Los intentos de la app se distinguen por la referencia estable que crea
  -- `create_mobile_payment`. Importaciones/históricos de servicio pueden no
  -- representar el inicio de un checkout nuevo y no se reinterpretan acá.
  if new.method = 'mobile'
    and new.external_reference like 'mobile-request:%'
    and not exists (
    select 1
    from public.table_sessions s
    join public.branches b
      on b.id = s.branch_id and b.restaurant_id = s.restaurant_id
    join private.payment_provider_credentials c
      on c.restaurant_id = s.restaurant_id and c.provider = 'mercado_pago'
    join private.payment_provider_branches pb
      on pb.restaurant_id = s.restaurant_id and pb.branch_id = s.branch_id
      and pb.provider = c.provider
    where s.id = new.session_id and s.restaurant_id = new.restaurant_id
      and b.is_active and 'mobile' = any(b.payment_methods)
  ) then
    raise exception 'PAYMENT_METHOD_DISABLED';
  end if;
  return new;
end;
$$;
create trigger payments_require_mobile_provider
before insert on public.payments
for each row execute function private.require_mobile_payment_provider();

revoke all on function
  public.get_payment_provider_config(uuid),
  public.save_payment_provider_config(uuid,public.payment_provider_environment,uuid[],text,text),
  public.delete_payment_provider_config(uuid),
  public.mobile_payment_available(uuid),
  public.resolve_payment_provider_for_session(uuid)
from public, anon, authenticated;

grant execute on function
  public.get_payment_provider_config(uuid),
  public.save_payment_provider_config(uuid,public.payment_provider_environment,uuid[],text,text),
  public.delete_payment_provider_config(uuid)
to authenticated, service_role;
grant execute on function public.mobile_payment_available(uuid) to authenticated, service_role;
grant execute on function public.resolve_payment_provider_for_session(uuid) to service_role;

comment on function public.resolve_payment_provider_for_session(uuid) is
  'Backend only: resuelve la cuenta receptora efectiva y sus secretos para una sesión.';

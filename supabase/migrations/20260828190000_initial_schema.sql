-- ============================================================
-- Schema inicial: plataforma de autoservicio para restaurantes
-- Núcleo multi-restaurante, menú configurable, sesiones de mesa,
-- pedidos con snapshot, pagos y capa POS (interno hoy, externos a futuro).
-- ============================================================

-- ---------- Enums ----------

create type public.member_role as enum ('owner', 'staff');
create type public.session_status as enum ('open', 'closed');
create type public.order_status as enum (
  'submitted', 'accepted', 'in_preparation', 'ready', 'delivered', 'cancelled'
);
create type public.payment_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.payment_mode as enum ('full', 'own', 'equal_split', 'custom');
create type public.pos_type as enum ('internal', 'fudo');

-- ---------- Núcleo multi-restaurante ----------

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  logo_url text,
  created_at timestamptz not null default now()
);

create table public.restaurant_members (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'staff',
  created_at timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  label text not null,
  qr_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Menú configurable ----------

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id uuid not null references public.menu_categories (id) on delete restrict,
  name text not null,
  description text,
  photo_url text,
  base_price numeric(10, 2) not null check (base_price >= 0),
  is_available boolean not null default true,
  -- tags dietarios estructurados para filtros y para el menú inteligente
  dietary_tags text[] not null default '{}',
  -- información alimentaria libre (ej: "contiene gluten y lactosa")
  food_info text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Composición declarada del plato: qué lleva y qué se puede quitar
create table public.product_ingredients (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  is_removable boolean not null default false,
  is_available boolean not null default true,
  sort_order integer not null default 0
);

-- Grupos de modificadores genéricos y reutilizables entre productos
create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null,
  -- min_select > 0 implica selección obligatoria
  min_select integer not null default 0 check (min_select >= 0),
  -- max_select = 1 => selección única; > 1 => múltiple
  max_select integer not null default 1 check (max_select >= 1),
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  check (min_select <= max_select)
);

create table public.modifier_options (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  group_id uuid not null references public.modifier_groups (id) on delete cascade,
  name text not null,
  price_delta numeric(10, 2) not null default 0,
  is_available boolean not null default true,
  sort_order integer not null default 0
);

create table public.product_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  group_id uuid not null references public.modifier_groups (id) on delete cascade,
  sort_order integer not null default 0,
  unique (product_id, group_id)
);

-- ---------- Sesiones de mesa ----------

create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id uuid not null references public.tables (id) on delete cascade,
  status public.session_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

-- A lo sumo una sesión abierta por mesa
create unique index table_sessions_one_open_per_table
  on public.table_sessions (table_id)
  where status = 'open';

create table public.session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);

-- ---------- Pedidos (con snapshot de precios y nombres) ----------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  session_id uuid not null references public.table_sessions (id) on delete cascade,
  submitted_by uuid references public.session_participants (id) on delete set null,
  status public.order_status not null default 'submitted',
  total_amount numeric(10, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  participant_id uuid references public.session_participants (id) on delete set null,
  is_shared boolean not null default false,
  quantity integer not null check (quantity > 0),
  -- snapshots al momento del pedido (el menú puede cambiar después)
  product_name text not null,
  base_price numeric(10, 2) not null,
  total_price numeric(10, 2) not null,
  notes text
);

create table public.order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  group_id uuid references public.modifier_groups (id) on delete set null,
  option_id uuid references public.modifier_options (id) on delete set null,
  group_name text not null,
  option_name text not null,
  price_delta numeric(10, 2) not null default 0
);

create table public.order_item_removed_ingredients (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  ingredient_id uuid references public.product_ingredients (id) on delete set null,
  ingredient_name text not null
);

-- ---------- Pagos ----------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  session_id uuid not null references public.table_sessions (id) on delete cascade,
  participant_id uuid references public.session_participants (id) on delete set null,
  amount numeric(10, 2) not null check (amount > 0),
  mode public.payment_mode not null,
  status public.payment_status not null default 'pending',
  mp_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Capa POS ----------

create table public.pos_integrations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  type public.pos_type not null default 'internal',
  -- credenciales del POS externo (vacío para el POS interno)
  credentials jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id)
);

create table public.pos_product_mappings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  external_id text not null,
  unique (product_id)
);

create table public.integration_logs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  event text not null,
  payload jsonb,
  error text,
  created_at timestamptz not null default now()
);

-- ---------- Índices ----------

create index on public.branches (restaurant_id);
create index on public.tables (branch_id);
create index on public.menu_categories (restaurant_id);
create index on public.products (restaurant_id, category_id);
create index on public.product_ingredients (product_id);
create index on public.modifier_groups (restaurant_id);
create index on public.modifier_options (group_id);
create index on public.product_modifier_groups (product_id);
create index on public.table_sessions (table_id);
create index on public.session_participants (session_id);
create index on public.orders (session_id);
create index on public.orders (restaurant_id, status);
create index on public.order_items (order_id);
create index on public.payments (session_id);
create index on public.integration_logs (restaurant_id, created_at);

-- ---------- Helpers para RLS ----------

create or replace function public.is_restaurant_member(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.restaurant_members
    where restaurant_id = rid and user_id = auth.uid()
  );
$$;

create or replace function public.is_session_participant(sid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.session_participants
    where session_id = sid and user_id = auth.uid()
  );
$$;

-- ---------- Row Level Security ----------

alter table public.restaurants enable row level security;
alter table public.restaurant_members enable row level security;
alter table public.branches enable row level security;
alter table public.tables enable row level security;
alter table public.menu_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_ingredients enable row level security;
alter table public.modifier_groups enable row level security;
alter table public.modifier_options enable row level security;
alter table public.product_modifier_groups enable row level security;
alter table public.table_sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.order_item_removed_ingredients enable row level security;
alter table public.payments enable row level security;
alter table public.pos_integrations enable row level security;
alter table public.pos_product_mappings enable row level security;
alter table public.integration_logs enable row level security;

-- Restaurantes: lectura pública (el menú es público), escritura para miembros
create policy "read restaurants" on public.restaurants
  for select using (true);
create policy "members update restaurant" on public.restaurants
  for update using (public.is_restaurant_member(id));
create policy "authenticated create restaurant" on public.restaurants
  for insert to authenticated with check (true);

-- Miembros: cada uno ve sus membresías y las de sus restaurantes.
-- Bootstrap: el primer miembro de un restaurante se agrega a sí mismo.
create policy "read own or same-restaurant members" on public.restaurant_members
  for select using (
    user_id = auth.uid() or public.is_restaurant_member(restaurant_id)
  );
create policy "bootstrap or member-invited insert" on public.restaurant_members
  for insert to authenticated with check (
    user_id = auth.uid() and (
      public.is_restaurant_member(restaurant_id)
      or not exists (
        select 1 from public.restaurant_members m
        where m.restaurant_id = restaurant_members.restaurant_id
      )
    )
  );
create policy "members delete members" on public.restaurant_members
  for delete using (public.is_restaurant_member(restaurant_id));

-- Entidades del menú y estructura: lectura pública, escritura para miembros
create policy "read branches" on public.branches for select using (true);
create policy "members write branches" on public.branches
  for all using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

create policy "read tables" on public.tables for select using (true);
create policy "members write tables" on public.tables
  for all using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

create policy "read categories" on public.menu_categories for select using (true);
create policy "members write categories" on public.menu_categories
  for all using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

create policy "read products" on public.products for select using (true);
create policy "members write products" on public.products
  for all using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

create policy "read ingredients" on public.product_ingredients for select using (true);
create policy "members write ingredients" on public.product_ingredients
  for all using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

create policy "read modifier groups" on public.modifier_groups for select using (true);
create policy "members write modifier groups" on public.modifier_groups
  for all using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

create policy "read modifier options" on public.modifier_options for select using (true);
create policy "members write modifier options" on public.modifier_options
  for all using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

create policy "read product modifier groups" on public.product_modifier_groups for select using (true);
create policy "members write product modifier groups" on public.product_modifier_groups
  for all using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

-- Sesiones de mesa: cualquiera puede encontrar/crear la sesión abierta de su mesa;
-- solo el restaurante la cierra o modifica.
create policy "read sessions" on public.table_sessions for select using (true);
create policy "authenticated open session" on public.table_sessions
  for insert to authenticated with check (status = 'open');
create policy "members update sessions" on public.table_sessions
  for update using (public.is_restaurant_member(restaurant_id));

-- Participantes: se unen a sí mismos, visibles para la mesa
create policy "read participants" on public.session_participants for select using (true);
create policy "join session as self" on public.session_participants
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own participant" on public.session_participants
  for update using (user_id = auth.uid());

-- Pedidos: los inserta la edge function (service role, bypassa RLS).
-- Los leen los participantes de la sesión y los miembros del restaurante.
-- Los estados los actualiza el POS interno (miembros).
create policy "participants and members read orders" on public.orders
  for select using (
    public.is_session_participant(session_id)
    or public.is_restaurant_member(restaurant_id)
  );
create policy "members update orders" on public.orders
  for update using (public.is_restaurant_member(restaurant_id));

create policy "read order items via order" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          public.is_session_participant(o.session_id)
          or public.is_restaurant_member(o.restaurant_id)
        )
    )
  );

create policy "read order item modifiers via order" on public.order_item_modifiers
  for select using (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id
        and (
          public.is_session_participant(o.session_id)
          or public.is_restaurant_member(o.restaurant_id)
        )
    )
  );

create policy "read removed ingredients via order" on public.order_item_removed_ingredients
  for select using (
    exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id
        and (
          public.is_session_participant(o.session_id)
          or public.is_restaurant_member(o.restaurant_id)
        )
    )
  );

-- Pagos: los gestiona la edge function (service role); lectura para la mesa y el restaurante
create policy "participants and members read payments" on public.payments
  for select using (
    public.is_session_participant(session_id)
    or public.is_restaurant_member(restaurant_id)
  );

-- Capa POS: solo miembros del restaurante
create policy "members manage pos integrations" on public.pos_integrations
  for all using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

create policy "members manage pos mappings" on public.pos_product_mappings
  for all using (public.is_restaurant_member(restaurant_id))
  with check (public.is_restaurant_member(restaurant_id));

create policy "members read integration logs" on public.integration_logs
  for select using (public.is_restaurant_member(restaurant_id));

-- ---------- Realtime ----------

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.table_sessions;
alter publication supabase_realtime add table public.session_participants;
alter publication supabase_realtime add table public.payments;

-- ---------- Storage: fotos de productos ----------

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "public read product images" on storage.objects
  for select using (bucket_id = 'product-images');

create policy "members write product images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'product-images'
    and exists (select 1 from public.restaurant_members where user_id = auth.uid())
  );

create policy "members update product images" on storage.objects
  for update to authenticated using (
    bucket_id = 'product-images'
    and exists (select 1 from public.restaurant_members where user_id = auth.uid())
  );

create policy "members delete product images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'product-images'
    and exists (select 1 from public.restaurant_members where user_id = auth.uid())
  );

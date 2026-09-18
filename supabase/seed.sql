-- ============================================================
-- Seed de desarrollo: 2 restaurantes demo con menús distintos
-- (valida que la plataforma es genérica) + usuarios admin demo.
--
-- Usuarios (solo para entorno local):
--   admin@esquina.demo / demo1234  -> La Esquina Burger
--   admin@nonna.demo   / demo1234  -> Trattoria Nonna
-- ============================================================

-- ---------- Usuarios admin demo (auth) ----------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'authenticated', 'authenticated',
    'admin@esquina.demo',
    crypt('demo1234', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'authenticated', 'authenticated',
    'admin@nonna.demo',
    crypt('demo1234', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(), '', '', '', ''
  );

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values
  (
    gen_random_uuid(),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","email":"admin@esquina.demo","email_verified":true}',
    'email', now(), now(), now()
  ),
  (
    gen_random_uuid(),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","email":"admin@nonna.demo","email_verified":true}',
    'email', now(), now(), now()
  );

-- ---------- Datos de los restaurantes ----------

do $$
declare
  r1 uuid; r2 uuid;
  b1 uuid; b2 uuid;
  -- categorías burger
  c_entradas uuid; c_burgers uuid; c_acomp uuid; c_bebidas uuid; c_postres uuid;
  -- categorías trattoria
  t_entradas uuid; t_pastas uuid; t_vinos uuid; t_postres uuid;
  -- grupos de modificadores
  g_carne uuid; g_extras uuid; g_guarnicion uuid;
  g_pasta uuid; g_salsa uuid; g_toppings uuid;
  -- productos
  p uuid;
begin
  -- ===== Restaurante 1: La Esquina Burger =====

  insert into public.restaurants (name, slug, description, menu_design)
  values ('La Esquina Burger', 'esquina-burger', 'Hamburguesas artesanales y papas', 'brasas')
  returning id into r1;

  insert into public.restaurant_members (restaurant_id, user_id, role)
  values (r1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner');

  insert into public.pos_integrations (restaurant_id, type) values (r1, 'internal');

  -- Empleados del POS: desbloquean el salón con PIN (Fase 1 del sprint 2)
  insert into public.pos_employees (restaurant_id, full_name, pin_hash) values
    (r1, 'Ana (mozo)', crypt('1234', gen_salt('bf'))),
    (r1, 'Bruno (cajero)', crypt('5678', gen_salt('bf')));

  insert into public.branches (restaurant_id, name, address)
  values (r1, 'Casa Central', 'Av. Siempreviva 742') returning id into b1;

  insert into public.tables (restaurant_id, branch_id, label, qr_token) values
    (r1, b1, 'Mesa 1', 'demo-burger-mesa-1'),
    (r1, b1, 'Mesa 2', 'demo-burger-mesa-2'),
    (r1, b1, 'Mesa 3', 'demo-burger-mesa-3'),
    (r1, b1, 'Mesa 4', 'demo-burger-mesa-4');

  insert into public.menu_categories (restaurant_id, name, sort_order) values
    (r1, 'Entradas', 0) returning id into c_entradas;
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    (r1, 'Hamburguesas', 1) returning id into c_burgers;
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    (r1, 'Acompañamientos', 2) returning id into c_acomp;
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    (r1, 'Bebidas', 3) returning id into c_bebidas;
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    (r1, 'Postres', 4) returning id into c_postres;

  -- Grupos de modificadores
  insert into public.modifier_groups (restaurant_id, name, min_select, max_select)
  values (r1, 'Tipo de carne', 1, 1) returning id into g_carne;
  insert into public.modifier_options (restaurant_id, group_id, name, price_delta, sort_order) values
    (r1, g_carne, 'Vacuna', 0, 0),
    (r1, g_carne, 'Pollo', 0, 1),
    (r1, g_carne, 'Veggie (no vacuno)', 500, 2);

  insert into public.modifier_groups (restaurant_id, name, min_select, max_select)
  values (r1, 'Extras', 0, 4) returning id into g_extras;
  insert into public.modifier_options (restaurant_id, group_id, name, price_delta, sort_order) values
    (r1, g_extras, 'Bacon', 900, 0),
    (r1, g_extras, 'Huevo frito', 600, 1),
    (r1, g_extras, 'Queso extra', 700, 2),
    (r1, g_extras, 'Medallón extra', 1800, 3);

  insert into public.modifier_groups (restaurant_id, name, min_select, max_select)
  values (r1, 'Guarnición', 1, 1) returning id into g_guarnicion;
  insert into public.modifier_options (restaurant_id, group_id, name, price_delta, sort_order) values
    (r1, g_guarnicion, 'Papas fritas', 0, 0),
    (r1, g_guarnicion, 'Papas rústicas', 400, 1),
    (r1, g_guarnicion, 'Ensalada', 0, 2);

  -- Productos
  insert into public.products (restaurant_id, category_id, name, description, base_price, dietary_tags, sort_order)
  values (r1, c_entradas, 'Bastones de muzzarella', '6 bastones rebozados con salsa de la casa', 4500, '{vegetariano}', 0);

  insert into public.products (restaurant_id, category_id, name, description, base_price, dietary_tags, food_info, sort_order)
  values (r1, c_entradas, 'Nachos con cheddar', 'Para compartir entre 2-3 personas', 5200, '{vegetariano}', 'Contiene lactosa', 1);

  insert into public.products (restaurant_id, category_id, name, description, base_price, food_info, sort_order)
  values (r1, c_burgers, 'Clásica', 'Medallón de 120g, cheddar, lechuga, tomate, cebolla y salsa de la casa', 8900, 'Contiene gluten y lactosa', 0)
  returning id into p;
  insert into public.product_ingredients (restaurant_id, product_id, name, is_removable, sort_order) values
    (r1, p, 'Pan de papa', false, 0),
    (r1, p, 'Medallón de carne', false, 1),
    (r1, p, 'Queso cheddar', true, 2),
    (r1, p, 'Lechuga', true, 3),
    (r1, p, 'Tomate', true, 4),
    (r1, p, 'Cebolla', true, 5),
    (r1, p, 'Salsa de la casa', true, 6);
  insert into public.product_modifier_groups (restaurant_id, product_id, group_id, sort_order) values
    (r1, p, g_carne, 0), (r1, p, g_extras, 1), (r1, p, g_guarnicion, 2);

  insert into public.products (restaurant_id, category_id, name, description, base_price, food_info, sort_order)
  values (r1, c_burgers, 'Doble Bacon', 'Doble medallón, doble cheddar, bacon crocante y alioli', 11500, 'Contiene gluten y lactosa', 1)
  returning id into p;
  insert into public.product_ingredients (restaurant_id, product_id, name, is_removable, sort_order) values
    (r1, p, 'Pan de papa', false, 0),
    (r1, p, 'Doble medallón de carne', false, 1),
    (r1, p, 'Doble cheddar', true, 2),
    (r1, p, 'Bacon', true, 3),
    (r1, p, 'Alioli', true, 4);
  insert into public.product_modifier_groups (restaurant_id, product_id, group_id, sort_order) values
    (r1, p, g_extras, 0), (r1, p, g_guarnicion, 1);

  insert into public.products (restaurant_id, category_id, name, description, base_price, dietary_tags, sort_order)
  values (r1, c_burgers, 'Veggie', 'Medallón de garbanzos y calabaza, queso, rúcula y tomate', 8500, '{vegetariano}', 2)
  returning id into p;
  insert into public.product_ingredients (restaurant_id, product_id, name, is_removable, sort_order) values
    (r1, p, 'Pan integral', false, 0),
    (r1, p, 'Medallón veggie', false, 1),
    (r1, p, 'Queso tybo', true, 2),
    (r1, p, 'Rúcula', true, 3),
    (r1, p, 'Tomate', true, 4);
  insert into public.product_modifier_groups (restaurant_id, product_id, group_id, sort_order) values
    (r1, p, g_extras, 0), (r1, p, g_guarnicion, 1);

  insert into public.products (restaurant_id, category_id, name, base_price, dietary_tags, sort_order) values
    (r1, c_acomp, 'Papas fritas', 3800, '{vegetariano}', 0),
    (r1, c_acomp, 'Aros de cebolla', 4200, '{vegetariano}', 1),
    (r1, c_bebidas, 'Agua sin gas', 2000, '{vegano,sin-tacc}', 0),
    (r1, c_bebidas, 'Gaseosa cola', 2500, '{vegano,sin-tacc}', 1),
    (r1, c_bebidas, 'Limonada de la casa', 3000, '{vegano,sin-tacc}', 2),
    (r1, c_postres, 'Brownie con helado', 4800, '{vegetariano}', 0),
    (r1, c_postres, 'Flan casero', 3900, '{vegetariano,sin-tacc}', 1);

  -- ===== Restaurante 2: Trattoria Nonna =====

  insert into public.restaurants (name, slug, description, menu_design)
  values ('Trattoria Nonna', 'trattoria-nonna', 'Cocina italiana de la nonna', 'linterna')
  returning id into r2;

  insert into public.restaurant_members (restaurant_id, user_id, role)
  values (r2, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner');

  insert into public.pos_integrations (restaurant_id, type) values (r2, 'internal');

  insert into public.pos_employees (restaurant_id, full_name, pin_hash) values
    (r2, 'Carla (mozo)', crypt('1234', gen_salt('bf')));

  insert into public.branches (restaurant_id, name, address)
  values (r2, 'Casa Central', 'Calle Falsa 123') returning id into b2;

  insert into public.tables (restaurant_id, branch_id, label, qr_token) values
    (r2, b2, 'Mesa 1', 'demo-nonna-mesa-1'),
    (r2, b2, 'Mesa 2', 'demo-nonna-mesa-2'),
    (r2, b2, 'Mesa 3', 'demo-nonna-mesa-3');

  insert into public.menu_categories (restaurant_id, name, sort_order) values
    (r2, 'Entradas', 0) returning id into t_entradas;
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    (r2, 'Pastas', 1) returning id into t_pastas;
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    (r2, 'Vinos', 2) returning id into t_vinos;
  insert into public.menu_categories (restaurant_id, name, sort_order) values
    (r2, 'Postres', 3) returning id into t_postres;

  insert into public.modifier_groups (restaurant_id, name, min_select, max_select)
  values (r2, 'Tipo de pasta', 1, 1) returning id into g_pasta;
  insert into public.modifier_options (restaurant_id, group_id, name, price_delta, sort_order) values
    (r2, g_pasta, 'Spaghetti', 0, 0),
    (r2, g_pasta, 'Penne rigate', 0, 1),
    (r2, g_pasta, 'Fusilli', 0, 2);

  insert into public.modifier_groups (restaurant_id, name, min_select, max_select)
  values (r2, 'Salsa', 1, 1) returning id into g_salsa;
  insert into public.modifier_options (restaurant_id, group_id, name, price_delta, sort_order) values
    (r2, g_salsa, 'Filetto', 0, 0),
    (r2, g_salsa, 'Bolognesa', 1200, 1),
    (r2, g_salsa, 'Crema y hongos', 1000, 2),
    (r2, g_salsa, 'Pesto genovés', 1500, 3);

  insert into public.modifier_groups (restaurant_id, name, min_select, max_select)
  values (r2, 'Toppings', 0, 3) returning id into g_toppings;
  insert into public.modifier_options (restaurant_id, group_id, name, price_delta, sort_order) values
    (r2, g_toppings, 'Parmesano rallado', 800, 0),
    (r2, g_toppings, 'Hongos salteados', 1400, 1),
    (r2, g_toppings, 'Aceitunas', 600, 2);

  insert into public.products (restaurant_id, category_id, name, description, base_price, dietary_tags, sort_order)
  values (r2, t_entradas, 'Bruschettas', 'Pan de campo, tomate, albahaca y aceite de oliva', 5500, '{vegetariano,vegano}', 0);

  insert into public.products (restaurant_id, category_id, name, description, base_price, food_info, sort_order)
  values (r2, t_entradas, 'Tabla de fiambres', 'Ideal para compartir: jamón crudo, salame, quesos y aceitunas', 9800, 'Contiene lactosa', 1);

  insert into public.products (restaurant_id, category_id, name, description, base_price, food_info, sort_order)
  values (r2, t_pastas, 'Pasta de la casa', 'Elegí tu pasta y tu salsa, amasada del día', 9500, 'Contiene gluten', 0)
  returning id into p;
  insert into public.product_modifier_groups (restaurant_id, product_id, group_id, sort_order) values
    (r2, p, g_pasta, 0), (r2, p, g_salsa, 1), (r2, p, g_toppings, 2);

  insert into public.products (restaurant_id, category_id, name, description, base_price, food_info, sort_order)
  values (r2, t_pastas, 'Ñoquis de papa', 'Con la salsa que elijas', 8900, 'Contiene gluten', 1)
  returning id into p;
  insert into public.product_modifier_groups (restaurant_id, product_id, group_id, sort_order) values
    (r2, p, g_salsa, 0), (r2, p, g_toppings, 1);

  insert into public.products (restaurant_id, category_id, name, description, base_price, food_info, sort_order)
  values (r2, t_pastas, 'Lasagna della nonna', 'Receta original: carne, jamón, muzzarella y bechamel', 12500, 'Contiene gluten y lactosa', 2);

  insert into public.products (restaurant_id, category_id, name, description, base_price, dietary_tags, food_info, sort_order)
  values (r2, t_pastas, 'Ravioles de verdura', 'Con manteca de salvia o la salsa que prefieras', 10200, '{vegetariano}', 'Contiene gluten y lactosa', 3)
  returning id into p;
  insert into public.product_modifier_groups (restaurant_id, product_id, group_id, sort_order) values
    (r2, p, g_salsa, 0), (r2, p, g_toppings, 1);

  insert into public.products (restaurant_id, category_id, name, base_price, dietary_tags, sort_order) values
    (r2, t_vinos, 'Copa de Malbec', 4500, '{vegano,sin-tacc}', 0),
    (r2, t_vinos, 'Botella de Malbec', 18000, '{vegano,sin-tacc}', 1),
    (r2, t_postres, 'Tiramisú', 5200, '{vegetariano}', 0),
    (r2, t_postres, 'Panna cotta con frutos rojos', 4800, '{vegetariano,sin-tacc}', 1);
end $$;

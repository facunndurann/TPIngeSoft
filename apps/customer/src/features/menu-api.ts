import { AppError, fromPostgres } from '@restaurant-platform/shared'
import { buildMenu, type Menu } from '@/features/menu'
import { supabase } from '@/lib/supabase'

export async function loadTable(token: string) {
  const { data: table, error } = await supabase
    .from('tables')
    .select('*')
    .eq('qr_token', token)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw fromPostgres(error)
  if (!table) {
    throw new AppError(
      'TABLE_UNAVAILABLE',
      'Este QR no corresponde a una mesa activa. Pedí ayuda al personal del restaurante.',
    )
  }

  const [branch, restaurant] = await Promise.all([
    supabase
      .from('branches')
      .select('*')
      .eq('id', table.branch_id)
      .eq('is_active', true)
      .single(),
    supabase.from('restaurants').select('*').eq('id', table.restaurant_id).single(),
  ])
  if (branch.error || restaurant.error) {
    throw new AppError(
      'TABLE_UNAVAILABLE',
      'El restaurante o la sucursal no están atendiendo. Pedí ayuda al personal.',
      branch.error?.message ?? restaurant.error?.message,
    )
  }
  return { table, branch: branch.data, restaurant: restaurant.data }
}

export async function loadMenu(restaurantId: string): Promise<Menu> {
  const [categories, products, groups] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .order('sort_order')
      .order('name'),
    // Cada producto trae sus ingredientes y los ids de sus grupos, ya ordenados.
    supabase
      .from('products')
      .select('*, product_ingredients(*), product_modifier_groups(group_id)')
      .eq('restaurant_id', restaurantId)
      .order('sort_order')
      .order('name')
      .order('sort_order', { referencedTable: 'product_ingredients' })
      .order('sort_order', { referencedTable: 'product_modifier_groups' }),
    // Los grupos se comparten entre productos: se piden una vez, con sus opciones.
    supabase
      .from('modifier_groups')
      .select('*, modifier_options(*)')
      .eq('restaurant_id', restaurantId)
      .order('sort_order', { referencedTable: 'modifier_options' }),
  ])
  // Uno por consulta: es lo que le prueba a TypeScript que cada `data` ya existe.
  if (categories.error) throw fromPostgres(categories.error)
  if (products.error) throw fromPostgres(products.error)
  if (groups.error) throw fromPostgres(groups.error)

  return buildMenu({ categories: categories.data, products: products.data, groups: groups.data })
}

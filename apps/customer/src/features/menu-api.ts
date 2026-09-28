import { AppError, unwrap } from '@restaurant-platform/shared'
import { buildMenu, type Menu } from '@/features/menu'
import { supabase } from '@/lib/supabase'

/**
 * La mesa del QR con su sucursal y su restaurante. Que alguna no esté (inactiva,
 * o fuera de lo que deja ver la RLS) es una mesa que no atiende, y reintentar no
 * lo cambia; una lectura que falla sí es reintentable y sale con su propio error.
 */
export async function loadTable(token: string) {
  const table = unwrap(
    await supabase.from('tables').select('*').eq('qr_token', token).eq('is_active', true).maybeSingle(),
  )
  if (!table) {
    throw new AppError(
      'TABLE_UNAVAILABLE',
      'Este QR no corresponde a una mesa activa. Pedí ayuda al personal del restaurante.',
    )
  }

  const [branchResponse, restaurantResponse] = await Promise.all([
    supabase.from('branches').select('*').eq('id', table.branch_id).eq('is_active', true).maybeSingle(),
    supabase.from('restaurants').select('*').eq('id', table.restaurant_id).maybeSingle(),
  ])
  const branch = unwrap(branchResponse)
  const restaurant = unwrap(restaurantResponse)
  if (!branch || !restaurant) {
    throw new AppError(
      'TABLE_UNAVAILABLE',
      'El restaurante o la sucursal no están atendiendo. Pedí ayuda al personal.',
    )
  }
  return { table, branch, restaurant }
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
  return buildMenu({ categories: unwrap(categories), products: unwrap(products), groups: unwrap(groups) })
}

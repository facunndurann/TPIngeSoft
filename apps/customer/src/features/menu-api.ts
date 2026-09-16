import { supabase } from '@/lib/supabase'

export async function loadTable(token: string) {
  const { data: table, error } = await supabase
    .from('tables')
    .select('*')
    .eq('qr_token', token)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  if (!table) throw new Error('El QR no corresponde a una mesa activa.')

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
    throw new Error('El restaurante o la sucursal no están disponibles.')
  }
  return { table, branch: branch.data, restaurant: restaurant.data }
}

export async function loadMenu(restaurantId: string) {
  const [categories, products, ingredients, groups, options, links] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .order('sort_order')
      .order('name'),
    supabase
      .from('products')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('sort_order')
      .order('name'),
    supabase
      .from('product_ingredients')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('sort_order'),
    supabase.from('modifier_groups').select('*').eq('restaurant_id', restaurantId),
    supabase
      .from('modifier_options')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('sort_order'),
    supabase
      .from('product_modifier_groups')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('sort_order'),
  ])

  for (const result of [categories, products, ingredients, groups, options, links]) {
    if (result.error) throw result.error
  }

  return {
    categories: categories.data!,
    products: products.data!,
    ingredients: ingredients.data!,
    groups: groups.data!,
    options: options.data!,
    links: links.data!,
  }
}

import { queryOptions } from '@tanstack/react-query'
import { type MenuDesignId, type Tables, unwrap } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'
import type { Membership } from '@/restaurant/restaurant-context'

/** Raíz de la key: invalidarla recarga la membresía sin tener que conocer al usuario. */
export const myRestaurantKey = ['my-restaurant'] as const

/**
 * Membresía administrativa (owner/manager activa) del usuario, o null si todavía
 * no tiene restaurante. El id sale de la sesión que ya tiene la app: no hace falta
 * otro viaje al servidor de auth, y la RLS decide con el mismo JWT.
 */
export const myRestaurantQuery = (userId: string) =>
  queryOptions({
    queryKey: [...myRestaurantKey, userId] as const,
    queryFn: async (): Promise<Membership | null> => {
      const [membership] = unwrap(
        await supabase
          .from('restaurant_members')
          .select('restaurant_id, role, restaurants(*)')
          .eq('user_id', userId)
          .eq('is_active', true)
          .in('role', ['owner', 'manager'])
          .limit(1),
      )
      if (!membership?.restaurants) {
        // Sin membresía admin: una cuenta de empleado (tiene profile) no entra;
        // una cuenta nueva sin restaurante va al onboarding.
        const profile = unwrap(
          await supabase.from('profiles').select('id').eq('id', userId).maybeSingle(),
        )
        if (profile) throw new Error('Acceso administrativo no habilitado')
        return null
      }
      return { restaurant: membership.restaurants, role: membership.role }
    },
  })

/** "La Ñata Café" → "la-nata-cafe". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Crea el restaurante con su primera sucursal y la membresía de dueño de quien
 * lo crea, en una sola transacción (`create_restaurant`). El identificador
 * público sale del nombre.
 */
export async function createRestaurant(input: {
  name: string
  description: string
  menuDesign: MenuDesignId
  branchName: string
}) {
  unwrap(
    await supabase.rpc('create_restaurant', {
      p_name: input.name,
      p_slug: slugify(input.name),
      p_description: input.description,
      p_menu_design: input.menuDesign,
      p_branch_name: input.branchName,
    }),
  )
}

export type RestaurantPatch = Partial<Pick<Tables<'restaurants'>, 'name' | 'description' | 'menu_design'>>

export async function updateRestaurant(restaurantId: string, patch: RestaurantPatch) {
  unwrap(await supabase.from('restaurants').update(patch).eq('id', restaurantId))
}

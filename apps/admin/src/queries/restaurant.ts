import { queryOptions } from '@tanstack/react-query'
import { unwrap } from '@restaurant-platform/shared'
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

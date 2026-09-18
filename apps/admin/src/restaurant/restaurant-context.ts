import { createContext, useContext } from 'react'
import type { Enums, Tables } from '@restaurant-platform/shared'

export type Restaurant = Tables<'restaurants'>
export type MemberRole = Enums<'member_role'>

export type Membership = {
  restaurant: Restaurant
  role: MemberRole
}

export const RestaurantContext = createContext<Membership | null>(null)

export function useMembership(): Membership {
  const membership = useContext(RestaurantContext)
  if (!membership) {
    throw new Error('useMembership debe usarse dentro de RestaurantGate')
  }
  return membership
}

export function useRestaurant(): Restaurant {
  return useMembership().restaurant
}

/** Roles con admin.manage; la base vuelve a verificar membresía activa y permisos. */
export function useIsAdmin(): boolean {
  return ['owner', 'manager'].includes(useMembership().role)
}

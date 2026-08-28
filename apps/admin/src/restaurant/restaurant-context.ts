import { createContext, useContext } from 'react'
import type { Tables } from '@restaurant-platform/shared'

export type Restaurant = Tables<'restaurants'>

export const RestaurantContext = createContext<Restaurant | null>(null)

export function useRestaurant(): Restaurant {
  const restaurant = useContext(RestaurantContext)
  if (!restaurant) {
    throw new Error('useRestaurant debe usarse dentro de RestaurantGate')
  }
  return restaurant
}

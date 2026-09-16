import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { posQueryKey } from './api'
import { subscribeToRestaurantPos } from './realtime'

const tabs = [
  { to: '/pos', label: 'Comandas', end: true },
  { to: '/pos/mesas', label: 'Mesas activas', end: false },
  { to: '/pos/historial', label: 'Historial', end: false },
]

export function PosPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()

  useEffect(() => {
    return subscribeToRestaurantPos(restaurant.id, () => {
      void queryClient.invalidateQueries({ queryKey: posQueryKey(restaurant.id) })
    })
  }, [restaurant.id, queryClient])

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">POS propio</p>
        <nav className="flex rounded-lg border border-neutral-200 bg-white p-1" aria-label="Secciones del POS">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium ${
                  isActive ? 'bg-indigo-600 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  )
}

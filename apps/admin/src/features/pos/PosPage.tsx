import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Lock, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { usePosOperator } from './operator-context'
import { subscribeToRestaurantPos } from './realtime'

const tabs = [
  { to: '/pos', label: 'Comandas', end: true },
  { to: '/pos/mesas', label: 'Mesas activas', end: false },
  { to: '/pos/historial', label: 'Historial', end: false },
]

export function PosPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const { operator, lock } = usePosOperator()

  useEffect(() => {
    return subscribeToRestaurantPos(restaurant.id, () => {
      void queryClient.invalidateQueries({ queryKey: ['pos', restaurant.id] })
    })
  }, [restaurant.id, queryClient])

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">POS propio</p>
          {operator ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
              <UserCheck size={13} />
              {operator.fullName}
            </span>
          ) : (
            // Sin empleados activos el POS lo opera el administrador (ver PosGate).
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
              Operando como administrador · cargá empleados para identificar quién atiende
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          {operator && (
            <Button variant="secondary" onClick={lock} title="Bloquear el POS para el próximo turno">
              <Lock size={15} />
              Bloquear
            </Button>
          )}
        </div>
      </div>
      <Outlet />
    </div>
  )
}

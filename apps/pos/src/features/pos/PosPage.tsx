import { useEffect } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { PosPermission } from '@restaurant-platform/shared'
import { Button } from '@restaurant-platform/ui'
import { useCan, usePosContext } from '@/context/pos-context'
import { supabase } from '@/lib/supabase'
import { subscribeToRestaurantPos } from './realtime'

const tabs: { to: string; label: string; permission: PosPermission }[] = [
  { to: '/', label: 'Comandas', permission: 'orders.read' },
  { to: '/salon', label: 'Salón', permission: 'floor.read' },
  { to: '/mesas', label: 'Mesas activas', permission: 'floor.read' },
  { to: '/historial', label: 'Historial', permission: 'history.read' },
]

export function PosPage({ multipleContexts }: { multipleContexts: boolean }) {
  const context = usePosContext()
  const can = useCan()
  const queryClient = useQueryClient()

  useEffect(
    () =>
      subscribeToRestaurantPos(context.restaurant_id, () => {
        void queryClient.invalidateQueries({ queryKey: ['pos', context.restaurant_id] })
      }),
    [context.restaurant_id, queryClient],
  )

  return (
    <main className="min-h-dvh space-y-5 bg-neutral-100 p-4 lg:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-bold">
            {context.restaurant_name} · {context.branch_name}
          </h1>
          <p className="text-sm text-neutral-600">{context.full_name}</p>
        </div>
        <div className="flex items-center gap-3">
          {multipleContexts && (
            <Link to="/select-context" className="text-sm text-indigo-700">
              Cambiar sucursal
            </Link>
          )}
          <Button variant="secondary" onClick={() => supabase.auth.signOut()}>
            Cerrar sesión
          </Button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Secciones del POS">
        {tabs
          .filter((tab) => can(tab.permission))
          .map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                `rounded-lg px-4 py-2 text-sm ${
                  isActive ? 'bg-indigo-600 text-white' : 'bg-white text-neutral-700'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
      </nav>

      <Outlet />
    </main>
  )
}

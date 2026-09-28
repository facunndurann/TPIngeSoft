import { useEffect } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Button, ClockProvider } from '@restaurant-platform/ui'
import { useCan, usePosContext } from '@/context/pos-context'
import { refreshPos } from '@/lib/query-client'
import { supabase } from '@/lib/supabase'
import { subscribeToRestaurantPos } from './realtime'
import { posSections } from './sections'

export function PosPage({ multipleContexts }: { multipleContexts: boolean }) {
  const context = usePosContext()
  const can = useCan()
  const queryClient = useQueryClient()

  useEffect(
    () =>
      subscribeToRestaurantPos(context.restaurant_id, () => {
        void refreshPos(queryClient)
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
        {posSections
          .filter((section) => can(section.permission))
          .map((section) => (
            <NavLink
              key={section.path}
              to={`/${section.path}`}
              // La portada es `/`, que es prefijo de todas: solo se marca exacta.
              end={section.path === ''}
              className={({ isActive }) =>
                `rounded-lg px-4 py-2 text-sm ${
                  isActive ? 'bg-indigo-600 text-white' : 'bg-white text-neutral-700'
                }`
              }
            >
              {section.label}
            </NavLink>
          ))}
      </nav>

      {/* El salón mira el tablero por horas: un tic cada 30 s alcanza para que
          los «hace X» no queden viejos y no redibuja de más una pantalla llena. */}
      <ClockProvider tickMs={30_000}>
        <Outlet />
      </ClockProvider>
    </main>
  )
}

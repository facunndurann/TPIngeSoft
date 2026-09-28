import { useEffect } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Badge, Button, ClockProvider } from '@restaurant-platform/ui'
import { useCan, usePosContext } from '@/context/pos-context'
import { refreshPos } from '@/lib/query-client'
import { supabase } from '@/lib/supabase'
import { alertSummary, posAlertCopy, usePosAlerts } from './alerts'
import { subscribeToRestaurantPos } from './realtime'
import { posSections } from './sections'
import { SoundControl } from './SoundControl'

export function PosPage({ multipleContexts }: { multipleContexts: boolean }) {
  const context = usePosContext()
  const can = useCan()
  const queryClient = useQueryClient()
  const alerts = usePosAlerts()

  useEffect(
    () =>
      subscribeToRestaurantPos(context.restaurant_id, () => {
        void refreshPos(queryClient)
      }),
    [context.restaurant_id, queryClient],
  )

  return (
    <div className="min-h-dvh space-y-5 bg-neutral-100 p-4 lg:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          {/* Dónde se trabaja, no el título de la pantalla: el único h1 es el de cada
              sección («Comandas», «Salón»…), que es lo que cambia al navegar. */}
          <p className="font-bold text-neutral-900">
            {context.restaurant_name} · {context.branch_name}
          </p>
          <p className="text-sm text-muted">{context.full_name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Suena para quien toma las comandas nuevas (ver usePosAlerts): solo ahí se controla. */}
          {can('orders.prepare') && <SoundControl />}
          {multipleContexts && (
            <Link to="/select-context" className="inline-flex min-h-11 items-center text-sm text-indigo-700">
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
                `inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm ${
                  isActive ? 'bg-indigo-600 text-white' : 'bg-white text-neutral-700'
                }`
              }
            >
              {section.label}
              {/* El espacio separa el número del nombre también para el lector de
                  pantalla: la pestaña se anuncia «Comandas 3 nuevas». */}
              {section.alert && alerts[section.alert] > 0 && (
                <>
                  {' '}
                  <Badge color={posAlertCopy[section.alert].tone} className="ml-2">
                    {posAlertCopy[section.alert].short(alerts[section.alert])}
                  </Badge>
                </>
              )}
            </NavLink>
          ))}
      </nav>

      {/* Una sola región para todo lo nuevo, con la frase completa: el lector de
          pantalla la lee cuando cambia, sin mover el foco de donde se está. */}
      <p role="status" aria-atomic="true" className="sr-only">
        {alertSummary(alerts)}
      </p>

      {/* El contenido principal es solo la sección: la cabecera y las pestañas
          quedan afuera, así «saltar al contenido» cae en su h1.
          El salón mira el tablero por horas: un tic cada 30 s alcanza para que
          los «hace X» no queden viejos y no redibuja de más una pantalla llena. */}
      <main>
        <ClockProvider tickMs={30_000}>
          <Outlet />
        </ClockProvider>
      </main>
    </div>
  )
}

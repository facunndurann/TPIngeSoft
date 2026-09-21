import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatElapsed, formatPrice, sessionRequestsOf } from '@restaurant-platform/shared'
import { useCan, useRestaurant } from '@/context/pos-context'
import { Badge, Button, EmptyState, ErrorText, Modal, Spinner, useNow, useSaveErrors } from '@restaurant-platform/ui'
import {
  closePosSession,
  loadRestaurantTables,
  posOpenSessionsQuery,
  posQueryKey,
  type PosOpenSessionCard,
} from './api'
import { AttendRequestButtons, ChargedBadge, SessionRequestBadges } from './ServiceRequests'

export function ActiveTables() {
  const restaurant = useRestaurant()
  const can = useCan()
  const canPay = can('payments.read')
  const queryClient = useQueryClient()
  const now = useNow()
  const [closing, setClosing] = useState<PosOpenSessionCard | null>(null)
  const errors = useSaveErrors()

  const sessions = useQuery(posOpenSessionsQuery(restaurant.id, restaurant.branchId))
  const tables = useQuery({
    queryKey: [...posQueryKey(restaurant.id, restaurant.branchId), 'tables'],
    queryFn: () => loadRestaurantTables(restaurant.id, restaurant.branchId),
  })

  const occupiedIds = new Set((sessions.data ?? []).map((session) => session.table_id))
  const freeTables = (tables.data ?? []).filter((table) => !occupiedIds.has(table.id))

  // Mesas que llamaron (MI-47), las que esperan hace más tiempo primero: es la
  // cola de atención del salón, aunque la tarjeta de la mesa esté más abajo.
  const calling = (sessions.data ?? [])
    .flatMap((session) => {
      const [oldest] = sessionRequestsOf(session)
      return oldest ? [{ session, since: oldest.requestedAt }] : []
    })
    .sort((a, b) => a.since.localeCompare(b.since))

  const closeMutation = useMutation(errors.saving('No pudimos cerrar la sesión.', {
    mutationFn: (sessionId: string) => closePosSession(sessionId),
    onSuccess: () => {
      setClosing(null)
      void queryClient.invalidateQueries({ queryKey: posQueryKey(restaurant.id, restaurant.branchId) })
    },
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Mesas activas</h1>
        <p className="text-sm text-neutral-500">
          Mesas que llamaron, consumo acumulado, estado de pago y cierre manual de sesión. El cobro
          digital corresponde a la siguiente fase; los cobros presenciales se registran desde la comanda.
        </p>
      </div>

      {(sessions.isError || tables.isError) && (
        <ErrorText error={sessions.error ?? tables.error} fallback="No pudimos actualizar el estado de las mesas." />
      )}

      {calling.length > 0 && (
        <section className="space-y-3" aria-labelledby="calling-heading">
          <h2 id="calling-heading" className="text-sm font-semibold text-neutral-700">
            Mesas que llamaron
          </h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {calling.map(({ session }) => (
              <li
                key={session.id}
                className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-neutral-900">{session.table_label}</p>
                  <Link to={`/salon/${session.table_id}`} className="text-sm text-indigo-700">
                    Ver comanda
                  </Link>
                </div>
                <SessionRequestBadges session={session} now={now} />
                <AttendRequestButtons sessionId={session.id} session={session} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {sessions.isLoading ? (
        <Spinner />
      ) : (sessions.data?.length ?? 0) === 0 ? (
        <EmptyState message="No hay mesas ocupadas en este momento." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(sessions.data ?? []).map((session) => {
            const kitchen = session.kitchen_tickets
            return (
              <article
                key={session.id}
                className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-neutral-900">{session.table_label}</p>
                    <p className="text-xs text-neutral-500">
                      {session.participant_names.length} comensal
                      {session.participant_names.length === 1 ? '' : 'es'} ·{' '}
                      {formatElapsed(session.opened_at, now, 'exact')}
                    </p>
                  </div>
                  {canPay && (
                    <Badge color={session.pending_amount > 0 ? 'amber' : 'green'}>
                      {session.pending_amount > 0 ? 'Pendiente' : 'Sin saldo'}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-neutral-500 break-words">
                  {session.participant_names.join(' · ') || 'Sin nombres'}
                </p>
                <SessionRequestBadges session={session} now={now} />
                {/* Cobrada y todavía abierta: es la mesa que hay que liberar. */}
                <ChargedBadge session={session} now={now} />
                {canPay && (
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-neutral-500">Por confirmar</dt>
                      <dd className="font-medium text-neutral-900">
                        {formatPrice(session.submitted_amount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">En cuenta</dt>
                      <dd className="font-medium text-neutral-900">
                        {formatPrice(session.total_amount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Pagado</dt>
                      <dd className="font-medium text-neutral-900">
                        {formatPrice(session.paid_amount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-neutral-500">Pendiente</dt>
                      <dd className="font-medium text-neutral-900">
                        {formatPrice(session.pending_amount)}
                      </dd>
                    </div>
                  </dl>
                )}
                {kitchen > 0 && (
                  <p className="text-xs text-indigo-700">
                    {kitchen} comanda{kitchen === 1 ? '' : 's'} en cocina
                  </p>
                )}
                <div className="flex gap-2">
                  <Link to={`/salon/${session.table_id}`} className="flex-1">
                    <Button className="w-full">Continuar comanda</Button>
                  </Link>
                  {can('sessions.close') && (
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => { errors.clear(); setClosing(session) }}
                    >
                      Cerrar sesión
                    </Button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {freeTables.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-700">Mesas libres</h2>
          <ul className="flex flex-wrap gap-2">
            {freeTables.map((table) => (
              <li key={table.id}>
                <Link
                  to={`/salon/${table.id}`}
                  className="block rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:border-indigo-400 hover:text-indigo-700"
                >
                  {table.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {closing && (
        <Modal title={`Cerrar ${closing.table_label}`} onClose={() => setClosing(null)}>
          <div className="space-y-3 text-sm text-neutral-700">
            <p>
              Los comensales no podrán enviar más pedidos en esta cuenta. Si vuelven a escanear el QR se
              abre una sesión nueva.
            </p>
            {canPay && closing.pending_amount > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">
                Queda {formatPrice(closing.pending_amount)} pendiente. Registrá el cobro desde la
                comanda antes de cerrar si la mesa ya pagó.
              </p>
            )}
            {closing.kitchen_tickets > 0 && (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-indigo-950">
                Hay {closing.kitchen_tickets} comanda{closing.kitchen_tickets === 1 ? '' : 's'} todavía en cocina. Van a
                seguir visibles en el tablero.
              </p>
            )}
            {closing.submitted_amount > 0 && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
                Hay pedidos enviados sin aceptar. Podés cancelarlos desde Comandas.
              </p>
            )}
            <ErrorText error={errors.message} />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setClosing(null)}>
                Seguir abierta
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                disabled={closeMutation.isPending}
                onClick={() => closeMutation.mutate(closing.id)}
              >
                {closeMutation.isPending ? 'Cerrando…' : 'Cerrar sesión'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

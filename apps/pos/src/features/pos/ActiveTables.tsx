import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { formatPrice, sessionRequestsOf } from '@restaurant-platform/shared'
import { useRestaurant } from '@/context/pos-context'
import { Badge, Button, Elapsed, EmptyState, ErrorText, Spinner } from '@restaurant-platform/ui'
import { posOpenSessionsQuery, posTablesQuery } from './queries'
import { CloseSessionButton } from './CloseSessionButton'
import { AttendRequestButtons, ChargedBadge, SessionRequestBadges } from './ServiceRequests'

export function ActiveTables() {
  const restaurant = useRestaurant()

  const sessions = useQuery(posOpenSessionsQuery(restaurant.id, restaurant.branchId))
  const tables = useQuery(posTablesQuery(restaurant.id, restaurant.branchId))

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
                <SessionRequestBadges session={session} />
                <AttendRequestButtons session={session} />
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
                      <Elapsed since={session.opened_at} precision="exact" />
                    </p>
                  </div>
                  {/* Sin payments.read la vista trae los importes en null: no hay saldo que mostrar. */}
                  {session.pending_amount !== null && (
                    <Badge color={session.pending_amount > 0 ? 'amber' : 'green'}>
                      {session.pending_amount > 0 ? 'Pendiente' : 'Sin saldo'}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-neutral-500 break-words">
                  {session.participant_names.join(' · ') || 'Sin nombres'}
                </p>
                <SessionRequestBadges session={session} />
                {/* Cobrada y todavía abierta: es la mesa que hay que liberar. */}
                <ChargedBadge session={session} />
                {session.total_amount !== null && (
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
                  <CloseSessionButton session={session} className="flex-1" />
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
    </div>
  )
}

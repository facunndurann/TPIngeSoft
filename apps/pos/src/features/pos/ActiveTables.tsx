import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { countLabel, formatPrice, sessionRequestsOf } from '@restaurant-platform/shared'
import { usePosScope } from '@/context/pos-context'
import { Badge, buttonClass, Elapsed, EmptyState, QueryView, useControlSize } from '@restaurant-platform/ui'
import { freeTables, posOpenSessionsQuery, posTablesQuery } from './queries'
import { CloseSessionButton } from './CloseSessionButton'
import { AttendRequestButtons, ChargedBadge, SessionRequestBadges } from './ServiceRequests'

export function ActiveTables() {
  const scope = usePosScope()
  const controlSize = useControlSize()

  const sessions = useQuery(posOpenSessionsQuery(scope))
  const tables = useQuery(posTablesQuery(scope))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Mesas activas</h1>
        <p className="text-sm text-muted">
          Mesas que llamaron, consumo acumulado, estado de pago y cierre manual de mesas. El cobro
          digital corresponde a la siguiente fase; los cobros presenciales se registran desde la comanda.
        </p>
      </div>

      <QueryView query={[sessions, tables]} fallback="No pudimos actualizar el estado de las mesas.">
        {([sessions, tables]) => {
          const free = freeTables(tables, sessions)
          // Mesas que llamaron (MI-47), las que esperan hace más tiempo primero: es la
          // cola de atención del salón, aunque la tarjeta de la mesa esté más abajo.
          const calling = sessions
            .flatMap((session) => {
              const [oldest] = sessionRequestsOf(session)
              return oldest ? [{ session, since: oldest.requestedAt }] : []
            })
            .sort((a, b) => a.since.localeCompare(b.since))

          // El vacío es solo de las ocupadas: las libres se siguen ofreciendo abajo.
          return (
            <>
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
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-neutral-900">{session.table_label}</p>
                          <Link to={`/salon/${session.table_id}`} className="inline-flex min-h-11 items-center text-sm text-indigo-700">
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

              {sessions.length === 0 ? (
                <EmptyState message="No hay mesas ocupadas en este momento." />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {sessions.map((session) => {
                    const kitchen = session.kitchen_tickets
                    return (
                      <article
                        key={session.id}
                        className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-neutral-900">{session.table_label}</p>
                            <p className="text-xs text-muted">
                              {countLabel(session.participant_names.length, 'comensal', 'comensales')} ·{' '}
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
                        <p className="text-xs text-muted break-words">
                          {session.participant_names.join(' · ') || 'Sin nombres'}
                        </p>
                        <SessionRequestBadges session={session} />
                        {/* Cobrada y todavía abierta: es la mesa que hay que liberar. */}
                        <ChargedBadge session={session} />
                        {session.total_amount !== null && (
                          <dl className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <dt className="text-muted">Por confirmar</dt>
                              <dd className="font-medium text-neutral-900">
                                {formatPrice(session.submitted_amount)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted">En cuenta</dt>
                              <dd className="font-medium text-neutral-900">
                                {formatPrice(session.total_amount)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted">Pagado</dt>
                              <dd className="font-medium text-neutral-900">
                                {formatPrice(session.paid_amount)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted">Pendiente</dt>
                              <dd className="font-medium text-neutral-900">
                                {formatPrice(session.pending_amount)}
                              </dd>
                            </div>
                          </dl>
                        )}
                        {kitchen > 0 && (
                          <p className="text-xs text-indigo-700">
                            {countLabel(kitchen, 'comanda')} en cocina
                          </p>
                        )}
                        <div className="flex gap-2">
                          {/* Navega, así que es un link; se ve como el botón de al lado. */}
                          <Link to={`/salon/${session.table_id}`} className={`${buttonClass('primary', controlSize)} flex-1`}>
                            Continuar comanda
                          </Link>
                          <CloseSessionButton session={session} className="flex-1" />
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}

              {free.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold text-neutral-700">Mesas libres</h2>
                  <ul className="flex flex-wrap gap-2">
                    {free.map((table) => (
                      <li key={table.id}>
                        <Link
                          to={`/salon/${table.id}`}
                          className="flex min-h-11 items-center rounded-lg border border-dashed border-neutral-300 bg-white px-3 text-sm text-muted hover:border-indigo-400 hover:text-indigo-700"
                        >
                          {table.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )
        }}
      </QueryView>
    </div>
  )
}

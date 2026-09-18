import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { asAmount, dayRangeUtc, formatElapsed, isKitchenTicket, localDateKey } from '@restaurant-platform/shared'
import { formatPrice } from '@/lib/format'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, Button, EmptyState, ErrorText, Modal, Spinner } from '@/components/ui'
import { closePosSession, loadBoardOrders, loadOpenSessions, loadRestaurantTables, loadSessionBills } from './api'
import { useOperatorId } from './operator-context'
import { useNow } from './useNow'
import type { PosBill, PosDiningTable, PosOpenSession } from './types'

export function ActiveTables() {
  const restaurant = useRestaurant()
  const operatorId = useOperatorId()
  const queryClient = useQueryClient()
  const now = useNow()
  const [closing, setClosing] = useState<PosOpenSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sessions = useQuery({
    queryKey: ['pos', restaurant.id, 'sessions'],
    queryFn: () => loadOpenSessions(restaurant.id),
    refetchInterval: 15000,
  })
  const bills = useQuery({
    queryKey: ['pos', restaurant.id, 'bills', sessions.data?.map((session) => session.id).join(',')],
    queryFn: () => loadSessionBills((sessions.data ?? []).map((session) => session.id)),
    enabled: !!sessions.data,
    refetchInterval: 15000,
  })
  const tables = useQuery({
    queryKey: ['pos', restaurant.id, 'tables'],
    queryFn: () => loadRestaurantTables(restaurant.id),
  })
  const board = useQuery({
    queryKey: ['pos', restaurant.id, 'board'],
    queryFn: () => loadBoardOrders(restaurant.id, dayRangeUtc(localDateKey()).start),
    refetchInterval: 15000,
  })

  const billBySession = useMemo(() => {
    const map = new Map<string, PosBill>()
    for (const bill of bills.data ?? []) {
      if (bill.session_id) map.set(bill.session_id, bill)
    }
    return map
  }, [bills.data])

  const occupiedIds = new Set((sessions.data ?? []).map((session) => session.table_id))
  const freeTables = (tables.data ?? []).filter((table) => !occupiedIds.has(table.id))
  const groupedOccupied = groupByBranch(sessions.data ?? [])
  const groupedFree = groupFreeByBranch(freeTables)

  const closeMutation = useMutation({
    mutationFn: (sessionId: string) => closePosSession(sessionId, operatorId),
    onSuccess: () => {
      setClosing(null)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['pos', restaurant.id] })
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No pudimos cerrar la sesión.'),
  })

  const closingBill = closing ? billBySession.get(closing.id) : undefined
  const closingKitchen = (board.data ?? []).filter(
    (order) => order.session_id === closing?.id && isKitchenTicket(order.status),
  ).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Mesas activas</h1>
        <p className="text-sm text-neutral-500">
          Consumo acumulado, estado de pago y cierre manual de sesión. El cobro digital corresponde a la
          siguiente fase.
        </p>
      </div>

      {(sessions.isError || bills.isError || tables.isError) && (
        <ErrorText message="No pudimos actualizar el estado de las mesas." />
      )}

      {sessions.isLoading ? (
        <Spinner />
      ) : (sessions.data?.length ?? 0) === 0 ? (
        <EmptyState message="No hay mesas ocupadas en este momento." />
      ) : (
        Object.entries(groupedOccupied).map(([branch, openSessions]) => (
          <section key={branch} className="space-y-3">
            <h2 className="text-sm font-semibold text-neutral-700">{branch}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {openSessions.map((session) => {
                const bill = billBySession.get(session.id)
                const kitchen = (board.data ?? []).filter(
                  (order) => order.session_id === session.id && isKitchenTicket(order.status),
                ).length
                return (
                  <article
                    key={session.id}
                    className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-neutral-900">{session.tables.label}</p>
                        <p className="text-xs text-neutral-500">
                          {session.session_participants.length} comensal
                          {session.session_participants.length === 1 ? '' : 'es'} ·{' '}
                          {formatElapsed(session.opened_at, now)}
                        </p>
                      </div>
                      <Badge color={asAmount(bill?.pending_amount) > 0 ? 'amber' : 'green'}>
                        {asAmount(bill?.pending_amount) > 0 ? 'Pendiente' : 'Sin saldo'}
                      </Badge>
                    </div>
                    <p className="text-xs text-neutral-500 break-words">
                      {session.session_participants.map((participant) => participant.display_name).join(' · ')
                        || 'Sin nombres'}
                    </p>
                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-neutral-500">Por confirmar</dt>
                        <dd className="font-medium text-neutral-900">
                          {formatPrice(asAmount(bill?.submitted_amount))}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-neutral-500">En cuenta</dt>
                        <dd className="font-medium text-neutral-900">
                          {formatPrice(asAmount(bill?.total_amount))}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-neutral-500">Pagado</dt>
                        <dd className="font-medium text-neutral-900">
                          {formatPrice(asAmount(bill?.paid_amount))}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-neutral-500">Pendiente</dt>
                        <dd className="font-medium text-neutral-900">
                          {formatPrice(asAmount(bill?.pending_amount))}
                        </dd>
                      </div>
                    </dl>
                    {kitchen > 0 && (
                      <p className="text-xs text-indigo-700">
                        {kitchen} comanda{kitchen === 1 ? '' : 's'} en cocina
                      </p>
                    )}
                    <Button variant="secondary" className="w-full" onClick={() => { setError(null); setClosing(session) }}>
                      Cerrar sesión
                    </Button>
                  </article>
                )
              })}
            </div>
          </section>
        ))
      )}

      {freeTables.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-700">Mesas libres</h2>
          {Object.entries(groupedFree).map(([branch, branchTables]) => (
            <div key={branch}>
              <p className="mb-2 text-xs text-neutral-500">{branch}</p>
              <ul className="flex flex-wrap gap-2">
                {branchTables.map((table) => (
                  <li
                    key={table.id}
                    className="rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600"
                  >
                    {table.label}
                    {!table.is_active && (
                      <span className="ml-2 text-xs text-red-600">Inactiva</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {closing && (
        <Modal title={`Cerrar ${closing.tables.label}`} onClose={() => setClosing(null)}>
          <div className="space-y-3 text-sm text-neutral-700">
            <p>
              Los comensales no podrán enviar más pedidos en esta cuenta. Si vuelven a escanear el QR se
              abre una sesión nueva.
            </p>
            {asAmount(closingBill?.pending_amount) > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">
                Queda {formatPrice(asAmount(closingBill?.pending_amount))} pendiente. El pago en efectivo no
                se registra todavía en el sistema.
              </p>
            )}
            {closingKitchen > 0 && (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-indigo-950">
                Hay {closingKitchen} comanda{closingKitchen === 1 ? '' : 's'} todavía en cocina. Van a
                seguir visibles en el tablero.
              </p>
            )}
            {asAmount(closingBill?.submitted_amount) > 0 && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
                Hay pedidos enviados sin aceptar. Podés cancelarlos desde Comandas.
              </p>
            )}
            <ErrorText message={error} />
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

function groupByBranch(sessions: PosOpenSession[]) {
  const grouped: Record<string, PosOpenSession[]> = {}
  for (const session of sessions) {
    const name = session.tables.branch?.name ?? 'Sucursal'
    grouped[name] ??= []
    grouped[name].push(session)
  }
  return grouped
}

function groupFreeByBranch(tables: PosDiningTable[]) {
  const grouped: Record<string, typeof tables> = {}
  for (const table of tables) {
    const name = table.branches?.name ?? 'Sucursal'
    grouped[name] ??= []
    grouped[name].push(table)
  }
  return grouped
}

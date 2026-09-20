import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { asAmount, enabledPaymentMethods, formatElapsed, formatPrice, getPosTableState, isKitchenTicket, type OrderStatus, paymentMethodLabels, posTableStateLabels, sessionRequestsOf } from '@restaurant-platform/shared'
import { ArrowLeft, Clock3, PlayCircle, UserRound, Users } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorText, Modal, Spinner, SummaryItem, useSaveErrors } from '@restaurant-platform/ui'
import { useCan, useRestaurant } from '@/context/pos-context'
import {
  closePosSession,
  loadRestaurantTables,
  loadSessionBills,
  loadSessionOrders,
  loadTableSession,
  openPosTableSession,
  transitionPosOrder,
} from './api'
import { OrderTicket } from './OrderTicket'
import { PaymentPanel } from './PaymentPanel'
import { AttendRequestButtons, ChargedBadge, SessionRequestBadges } from './ServiceRequests'
import { useNow } from './useNow'

/**
 * Comanda de una mesa abierta desde el plano (MI-64). La misma pantalla sirve
 * para abrir una mesa libre y para continuar una ocupada; el sector desde el
 * que se llegó viaja en la query para poder volver al mismo lugar del plano.
 */
export function TableCommand() {
  const { tableId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const restaurant = useRestaurant()
  const can = useCan()
  const queryClient = useQueryClient()
  const now = useNow()
  const [closing, setClosing] = useState(false)
  const errors = useSaveErrors()
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null)

  const backToMap = `/salon${searchParams.toString() ? `?${searchParams}` : ''}`

  const tables = useQuery({
    queryKey: ['pos', restaurant.id, restaurant.branchId, 'tables'],
    queryFn: () => loadRestaurantTables(restaurant.id, restaurant.branchId),
  })
  const session = useQuery({
    queryKey: ['pos', restaurant.id, restaurant.branchId, 'table-session', tableId],
    queryFn: () => loadTableSession(tableId),
    refetchInterval: 15000,
  })
  const sessionId = session.data?.id
  const orders = useQuery({
    queryKey: ['pos', restaurant.id, restaurant.branchId, 'session-orders', sessionId],
    queryFn: () => loadSessionOrders(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 15000,
  })
  const bills = useQuery({
    queryKey: ['pos', restaurant.id, restaurant.branchId, 'bills', sessionId ?? ''],
    queryFn: () => loadSessionBills(sessionId ? [sessionId] : []),
    enabled: !!sessionId,
    refetchInterval: 15000,
  })

  const table = tables.data?.find((entry) => entry.id === tableId)
  const bill = bills.data?.[0]

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['pos', restaurant.id] })

  const openSession = useMutation(errors.saving('No pudimos abrir la comanda.', {
    mutationFn: () => openPosTableSession(tableId),
    onSuccess: refresh,
  }))

  const transition = useMutation(errors.saving('No pudimos actualizar el pedido.', {
    mutationFn: ({ orderId, status }: { orderId: string; status: OrderStatus }) =>
      transitionPosOrder(orderId, status),
    onMutate: ({ orderId }) => setPendingOrderId(orderId),
    onSuccess: refresh,
    onSettled: () => setPendingOrderId(null),
  }))

  const close = useMutation(errors.saving('No pudimos cerrar la sesión.', {
    mutationFn: () => closePosSession(sessionId!),
    onSuccess: () => {
      setClosing(false)
      refresh()
    },
  }))

  if (tables.isLoading || session.isLoading) return <Spinner />

  if (tables.isError || session.isError) {
    return (
      <div className="space-y-3">
        <BackLink to={backToMap} />
        <ErrorText message="No pudimos cargar la comanda de la mesa." />
      </div>
    )
  }

  if (!table) {
    return (
      <div className="space-y-3">
        <BackLink to={backToMap} />
        <EmptyState message="Esa mesa ya no está disponible para operar. Volvé al plano." />
      </div>
    )
  }

  const open = session.data
  const state = getPosTableState(open)
  const branchMethods = enabledPaymentMethods(table.branches)
  const kitchenOrders = (orders.data ?? []).filter((order) => isKitchenTicket(order.status)).length

  return (
    <div className="min-w-0 space-y-4">
      <BackLink to={backToMap} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{table.label}</h1>
          <p className="text-sm text-neutral-500">
            {table.floor_sections?.name ?? 'Sin sector'}
            {table.branches ? ` · ${table.branches.name}` : ''} · {table.seats} lugares
          </p>
          {/* Lo que el admin habilitó para esta sucursal (MI-48): es lo que el
              comensal ve como opción y lo único que se le puede cobrar acá. */}
          <p className="text-xs text-neutral-500">
            Medios de pago:{' '}
            {branchMethods.length === 0
              ? 'ninguno habilitado'
              : branchMethods.map((method) => paymentMethodLabels[method]).join(' · ')}
          </p>
        </div>
        <Badge color={open ? 'indigo' : 'green'}>{posTableStateLabels[state]}</Badge>
      </div>

      <ErrorText message={errors.message} />

      {!open ? (
        <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6 text-center">
          <p className="text-sm text-neutral-600">
            La mesa está libre. Al abrir la comanda queda ocupada en el plano y los comensales pueden
            sumarse escaneando el QR.
          </p>
          {can('sessions.open') ? (
            <Button
              className="mx-auto"
              disabled={openSession.isPending}
              onClick={() => openSession.mutate()}
            >
              <PlayCircle size={16} />
              {openSession.isPending ? 'Abriendo…' : 'Abrir comanda'}
            </Button>
          ) : (
            <p className="text-sm text-neutral-500">Tu rol no abre comandas. Pedíselo a un mozo o supervisor.</p>
          )}
        </div>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-8 gap-y-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm">
            <SummaryItem as="dl-pair" icon={Clock3} label="Abierta" value={formatElapsed(open.opened_at, now)} />
            {can('payments.read') && <>
              <SummaryItem as="dl-pair" label="En cuenta" value={formatPrice(bill?.total_amount)} />
              <SummaryItem as="dl-pair" label="Pagado" value={formatPrice(bill?.paid_amount)} />
              <SummaryItem as="dl-pair" label="Pendiente" value={formatPrice(bill?.pending_amount)} />
            </>}
            <SummaryItem
              as="dl-pair"
              icon={UserRound}
              label="Responsable"
              value={open.assigned_employee?.full_name ?? 'Sin asignar'}
            />
            <SummaryItem
              as="dl-pair"
              icon={Users}
              label="Comensales"
              value={String(open.session_participants.length)}
            />
          </dl>

          {/* La mesa llamó: se atiende desde la misma comanda, sin volver al plano. */}
          {sessionRequestsOf(open).length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <SessionRequestBadges session={open} now={now} />
              <AttendRequestButtons sessionId={open.id} session={open} />
            </div>
          )}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-neutral-800">
                Pedidos de la mesa
                {kitchenOrders > 0 && (
                  <span className="ml-2 text-xs font-normal text-indigo-700">
                    {kitchenOrders} en cocina
                  </span>
                )}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {/* Cobrada y abierta: el mozo que cobró no cierra, avisa a quien sí. */}
                <ChargedBadge session={open} now={now} />
                {can('sessions.close') && <Button variant="secondary" onClick={() => setClosing(true)}>
                  Cerrar sesión
                </Button>}
              </div>
            </div>

            {orders.isLoading ? (
              <Spinner />
            ) : (orders.data?.length ?? 0) === 0 ? (
              <EmptyState message="Todavía no hay pedidos en esta mesa. Los comensales pueden pedir desde el QR." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {orders.data?.map((order) => (
                  <OrderTicket
                    key={order.id}
                    order={order}
                    now={now}
                    busy={pendingOrderId === order.id}
                    error={null}
                    onTransition={(to) => {
                      const confirmed =
                        to !== 'cancelled' ||
                        window.confirm(`¿Cancelar este pedido de ${table.label}? Se saca de la cuenta.`)
                      if (confirmed) transition.mutate({ orderId: order.id, status: to })
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          {can('payments.read') && (
            <PaymentPanel sessionId={open.id} bill={bill} enabledMethods={branchMethods} />
          )}
        </>
      )}

      {closing && open && (
        <Modal title={`Cerrar ${table.label}`} onClose={() => setClosing(false)}>
          <div className="space-y-3 text-sm text-neutral-700">
            <p>
              Los comensales no podrán enviar más pedidos en esta cuenta. Si vuelven a escanear el QR
              se abre una sesión nueva.
            </p>
            {can('payments.read') && asAmount(bill?.pending_amount) > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">
                Queda {formatPrice(bill?.pending_amount)} pendiente.
              </p>
            )}
            {kitchenOrders > 0 && (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-indigo-950">
                Hay {kitchenOrders} comanda{kitchenOrders === 1 ? '' : 's'} todavía en cocina. Van a
                seguir visibles en el tablero.
              </p>
            )}
            <ErrorText message={errors.message} />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setClosing(false)}>
                Seguir abierta
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                disabled={close.isPending}
                onClick={() => close.mutate()}
              >
                {close.isPending ? 'Cerrando…' : 'Cerrar sesión'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function BackLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-indigo-700"
    >
      <ArrowLeft size={16} />
      Volver al plano
    </Link>
  )
}

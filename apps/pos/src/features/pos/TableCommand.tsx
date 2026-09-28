import { Link, useParams, useSearchParams } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { formatPrice, getPosTableState, paymentMethodLabels, sessionRequestsOf, type PaymentMethod } from '@restaurant-platform/shared'
import { ArrowLeft, Clock3, PlayCircle, UserRound, Users } from 'lucide-react'
import { Button, Elapsed, EmptyState, ErrorText, Spinner, SummaryItem, useSaveErrors } from '@restaurant-platform/ui'
import { useCan, useRestaurant } from '@/context/pos-context'
import { CloseSessionButton } from './CloseSessionButton'
import { OrderTicket } from './OrderTicket'
import { PaymentPanel } from './PaymentPanel'
import {
  openPosTableSession,
  posOpenSessionsQuery,
  posPaymentMethodsQuery,
  posTablesQuery,
  sessionOrdersQuery,
  type PosOpenSession,
} from './queries'
import { AttendRequestButtons, ChargedBadge, SessionRequestBadges } from './ServiceRequests'
import { TableStateBadge } from './StatusBadges'

/**
 * Comanda de una mesa abierta desde el plano (MI-64). Resuelve la mesa y su
 * sesión, muestra la cabecera común y deriva en `FreeTable` u `OccupiedTable`;
 * el sector desde el que se llegó viaja en la query para poder volver al mismo
 * lugar del plano.
 */
export function TableCommand() {
  const { tableId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const restaurant = useRestaurant()

  const backToMap = `/salon${searchParams.toString() ? `?${searchParams}` : ''}`

  const tables = useQuery(posTablesQuery(restaurant.id, restaurant.branchId))
  // La misma lectura que el plano y Mesas activas: la mesa está ocupada si su
  // sesión figura entre las abiertas de la sucursal.
  const sessions = useQuery(posOpenSessionsQuery(restaurant.id, restaurant.branchId))
  const paymentMethods = useQuery(posPaymentMethodsQuery(restaurant.id, restaurant.branchId))

  if (tables.isLoading || sessions.isLoading || paymentMethods.isLoading) return <Spinner />

  if (tables.isError || sessions.isError || paymentMethods.isError) {
    return (
      <div className="space-y-3">
        <BackLink to={backToMap} />
        <ErrorText
          error={tables.error ?? sessions.error ?? paymentMethods.error}
          fallback="No pudimos cargar la comanda de la mesa."
        />
      </div>
    )
  }

  const table = tables.data?.find((entry) => entry.id === tableId)

  if (!table) {
    return (
      <div className="space-y-3">
        <BackLink to={backToMap} />
        <EmptyState message="Esa mesa ya no está disponible para operar. Volvé al plano." />
      </div>
    )
  }

  const session = sessions.data?.find((entry) => entry.table_id === tableId)
  const branchMethods = paymentMethods.data ?? []

  return (
    <div className="min-w-0 space-y-4">
      <BackLink to={backToMap} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{table.label}</h1>
          <p className="text-sm text-neutral-500">
            {table.floor_sections?.name ?? 'Sin sector'} · {table.seats} lugares
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
        <TableStateBadge state={getPosTableState(session)} />
      </div>

      {/* La key reinicia la pantalla si en la mesa se abre otra sesión: no se
          arrastran pedidos, confirmaciones ni errores de la anterior. */}
      {session ? (
        <OccupiedTable key={session.id} session={session} paymentMethods={branchMethods} />
      ) : (
        <FreeTable tableId={table.id} />
      )}
    </div>
  )
}

/** Mesa sin sesión: lo único que se puede hacer es abrir la comanda. */
function FreeTable({ tableId }: { tableId: string }) {
  const can = useCan()
  const errors = useSaveErrors()

  // El «Abriendo…» sigue hasta que el cliente del POS relee las mesas abiertas
  // y la pantalla pasa a la de mesa ocupada.
  const openSession = useMutation(errors.saving('No pudimos abrir la comanda.', {
    mutationFn: () => openPosTableSession(tableId),
  }))

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6 text-center">
      <p className="text-sm text-neutral-600">
        La mesa está libre. Al abrir la comanda queda ocupada en el plano y los comensales pueden
        sumarse escaneando el QR.
      </p>
      <ErrorText error={errors.message} />
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
  )
}

/** Mesa con sesión abierta: resumen de la cuenta, llamados, pedidos, cobro y cierre. */
function OccupiedTable({ session, paymentMethods }: { session: PosOpenSession; paymentMethods: PaymentMethod[] }) {
  const restaurant = useRestaurant()
  const can = useCan()

  const orders = useQuery(sessionOrdersQuery(restaurant.id, restaurant.branchId, session.id))

  const kitchen = session.kitchen_tickets

  return (
    <>
      <dl className="flex flex-wrap gap-x-8 gap-y-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm">
        <SummaryItem as="dl-pair" icon={Clock3} label="Abierta" value={<Elapsed since={session.opened_at} precision="exact" />} />
        {/* Los importes vienen juntos o no vienen: sin payments.read la vista los trae en null. */}
        {session.total_amount !== null && <>
          <SummaryItem as="dl-pair" label="En cuenta" value={formatPrice(session.total_amount)} />
          <SummaryItem as="dl-pair" label="Pagado" value={formatPrice(session.paid_amount)} />
          <SummaryItem as="dl-pair" label="Pendiente" value={formatPrice(session.pending_amount)} />
        </>}
        <SummaryItem
          as="dl-pair"
          icon={UserRound}
          label="Responsable"
          value={session.assigned_employee_name ?? 'Sin asignar'}
        />
        <SummaryItem
          as="dl-pair"
          icon={Users}
          label="Comensales"
          value={String(session.participant_names.length)}
        />
      </dl>

      {/* La mesa llamó: se atiende desde la misma comanda, sin volver al plano. */}
      {sessionRequestsOf(session).length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <SessionRequestBadges session={session} />
          <AttendRequestButtons session={session} />
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-800">
            Pedidos de la mesa
            {kitchen > 0 && (
              <span className="ml-2 text-xs font-normal text-indigo-700">
                {kitchen} en cocina
              </span>
            )}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* Cobrada y abierta: el mozo que cobró no cierra, avisa a quien sí. */}
            <ChargedBadge session={session} />
            <CloseSessionButton session={session} />
          </div>
        </div>

        {orders.isLoading ? (
          <Spinner />
        ) : (orders.data?.length ?? 0) === 0 ? (
          <EmptyState message="Todavía no hay pedidos en esta mesa. Los comensales pueden pedir desde el QR." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {orders.data?.map((order) => (
              <OrderTicket key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>

      {can('payments.read') && (
        <PaymentPanel sessionId={session.id} pendingAmount={session.pending_amount} enabledMethods={paymentMethods} />
      )}
    </>
  )
}

function BackLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-indigo-700"
    >
      <ArrowLeft size={16} />
      Volver al plano
    </Link>
  )
}

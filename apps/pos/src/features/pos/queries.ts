import { queryOptions } from '@tanstack/react-query'
import type { QueryData } from '@supabase/supabase-js'
import {
  AppError,
  enabledPaymentMethods,
  isOperable,
  kitchenTicketStatuses,
  localDateKey,
  unwrap,
  type OrderStatus,
  type PaymentMethod,
  type SessionRequestKind,
  type Tables,
} from '@restaurant-platform/shared'
import { posRootKey } from '@/lib/query-client'
import { posOrderSelect } from './order-select'
import { supabase } from '@/lib/supabase'

/**
 * Relectura periódica de las pantallas vivas del POS. Es el respaldo de
 * realtime: si se pierde un aviso, el dato se corrige solo a los 15 segundos.
 */
export const POS_REFETCH_INTERVAL = 15_000

/** Raíz de las queries del POS en una sucursal. */
const posQueryKey = (restaurantId: string, branchId: string) =>
  [...posRootKey, restaurantId, branchId] as const

/**
 * Restaurantes y sucursales en los que la cuenta puede operar. Queda fuera de
 * `posRootKey` a propósito: guardar un pedido no cambia los permisos, y así una
 * escritura no vuelve a pedirlos.
 */
export const posContextsQuery = (userId: string) =>
  queryOptions({
    queryKey: ['pos-contexts', userId],
    queryFn: async () => unwrap(await supabase.rpc('get_pos_contexts')),
    refetchInterval: POS_REFETCH_INTERVAL,
    refetchOnWindowFocus: 'always',
  })

/** Pedidos con ítems, sesión, comensales y mesa: la forma de una comanda en todo el POS. */
const ordersOf = () => supabase.from('orders').select(posOrderSelect)

export type PosOrder = QueryData<ReturnType<typeof ordersOf>>[number]
export type PosOrderItem = PosOrder['order_items'][number]

/** Nombre del comensal que figura en el pedido, o «Comensal» si ya no está en la sesión. */
export function participantName(order: PosOrder, participantId: string | null) {
  return order.table_sessions.session_participants.find((entry) => entry.id === participantId)
    ?.display_name ?? 'Comensal'
}

const branchOrdersOf = (restaurantId: string, branchId: string) =>
  ordersOf()
    .eq('restaurant_id', restaurantId)
    .eq('table_sessions.branch_id', branchId)

/** Comandas activas y las entregadas hoy (día del restaurante, columna local_date). */
export const posBoardQuery = (restaurantId: string, branchId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'board'],
    queryFn: async () =>
      unwrap(
        await branchOrdersOf(restaurantId, branchId)
          .or(`status.in.(${kitchenTicketStatuses.join(',')}),and(status.eq.delivered,local_date.eq.${localDateKey()})`)
          .order('created_at', { ascending: false }),
      ),
    refetchInterval: POS_REFETCH_INTERVAL,
  })

export const posHistoryQuery = (restaurantId: string, branchId: string, dateKey: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'history', dateKey],
    queryFn: async () =>
      unwrap(
        await branchOrdersOf(restaurantId, branchId)
          .eq('local_date', dateKey)
          .order('created_at', { ascending: false }),
      ),
    refetchInterval: POS_REFETCH_INTERVAL,
  })

/** Pedidos de una sesión, para la comanda de la mesa. */
export const sessionOrdersQuery = (restaurantId: string, branchId: string, sessionId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'session-orders', sessionId],
    queryFn: async () =>
      unwrap(await ordersOf().eq('session_id', sessionId).order('created_at', { ascending: false })),
    refetchInterval: POS_REFETCH_INTERVAL,
  })

type OpenSessionRow = Tables<'pos_open_sessions'>

/**
 * Columnas de la vista cuyo null significa algo. El generador marca todas las
 * columnas de una vista como nullable; de verdad lo son solo estas:
 * - las solicitudes: la mesa no pidió, o no se atendió;
 * - los importes: salen de `session_bills`, que solo tiene fila para quien
 *   tiene `payments.read`. Son null los cuatro juntos, y null es «no se puede
 *   ver», no «debe $0»;
 * - el responsable: nadie tiene la mesa asignada.
 */
type NullableOpenSessionColumn =
  | 'bill_requested_at'
  | 'bill_attended_at'
  | 'in_person_payment_requested_at'
  | 'in_person_payment_attended_at'
  | 'submitted_amount'
  | 'total_amount'
  | 'paid_amount'
  | 'pending_amount'
  | 'assigned_employee_name'

/**
 * Sesión abierta tal como la lee todo el POS (plano, comanda, mesas activas y
 * traslado): una fila de `pos_open_sessions` con mesa, comensales, cuenta,
 * solicitudes, responsable y comandas en cocina. Es el único tipo escrito a
 * mano: `QueryData` no puede saber qué columnas de una vista son nullable. La
 * mesa no es nullable acá porque la lectura trae solo cuentas de mesa
 * (`kind = 'table'`); en la vista sí lo es, por las cuentas para llevar.
 */
export type PosOpenSession = {
  [Column in Exclude<keyof OpenSessionRow, NullableOpenSessionColumn>]-?: NonNullable<OpenSessionRow[Column]>
} & { [Column in NullableOpenSessionColumn]: NonNullable<OpenSessionRow[Column]> | null }

const openSessionsOf = (restaurantId: string, branchId: string) =>
  supabase
    .from('pos_open_sessions')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('branch_id', branchId)
    // Las mesas abiertas: una cuenta para llevar no ocupa mesa ni va a /salon.
    .eq('kind', 'table')
    .order('opened_at', { ascending: true })
    .overrideTypes<PosOpenSession[], { merge: false }>()

/**
 * Mesas abiertas de la sucursal: la única lectura de sesiones del POS. Todas
 * las pantallas comparten esta key, así que un cambio refresca a todas juntas.
 */
export const posOpenSessionsQuery = (restaurantId: string, branchId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'open-sessions'],
    queryFn: async () => unwrap(await openSessionsOf(restaurantId, branchId)),
    refetchInterval: POS_REFETCH_INTERVAL,
  })

const tablesOf = (restaurantId: string, branchId: string) =>
  supabase
    .from('tables')
    .select(
      'id, label, is_active, is_visible, section_id, position_x, position_y, seats, shape, width, height, floor_sections (id, name, sort_order, is_active)',
    )
    .eq('restaurant_id', restaurantId)
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .eq('is_visible', true)
    .order('label')

export type PosDiningTable = QueryData<ReturnType<typeof tablesOf>>[number]

/**
 * Mesas que el POS puede operar en la sucursal. Quedan afuera las que están
 * fuera de servicio, las ocultas del plano y las de un sector dado de baja. La
 * sucursal no se revisa: `get_pos_contexts` solo devuelve contextos de
 * sucursales activas.
 */
export const posTablesQuery = (restaurantId: string, branchId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'tables'],
    queryFn: async () =>
      unwrap(await tablesOf(restaurantId, branchId)).filter((table) =>
        isOperable(table, table.floor_sections),
      ),
  })

/** Sectores activos que el POS puede recorrer, incluso si todavía están vacíos. */
export const posFloorSectionsQuery = (restaurantId: string, branchId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'floor-sections'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('floor_sections')
          .select('id, name, sort_order, is_active')
          .eq('restaurant_id', restaurantId)
          .eq('branch_id', branchId)
          .eq('is_active', true)
          .order('sort_order')
          .order('name'),
      ),
  })

/**
 * Medios de pago que el admin habilitó en la sucursal (MI-48). Son de la
 * sucursal y no de cada mesa: se leen una vez y los comparte toda comanda.
 */
export const posPaymentMethodsQuery = (restaurantId: string, branchId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'payment-methods'],
    queryFn: async () =>
      enabledPaymentMethods(
        unwrap(
          await supabase
            .from('branches')
            .select('payment_methods')
            .eq('restaurant_id', restaurantId)
            .eq('id', branchId)
            .maybeSingle(),
        ),
      ),
  })

/** Pagos de una sesión, del más reciente al más viejo. */
export const sessionPaymentsQuery = (restaurantId: string, branchId: string, sessionId: string) =>
  queryOptions({
    queryKey: [...posQueryKey(restaurantId, branchId), 'payments', sessionId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('payments')
          .select('id, participant_id, amount, mode, method, status, external_reference, created_at')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false }),
      ),
    refetchInterval: POS_REFETCH_INTERVAL,
  })

// Escrituras. Ninguna refresca la caché por su cuenta: de eso se encarga el
// MutationCache de createPosQueryClient después de cada una que sale bien.

/**
 * Registra un cobro presencial o externo. Si es la cuenta completa o un importe
 * parcial lo decide la RPC, con el pendiente real y la sesión bloqueada.
 */
export async function recordPosPayment(input: {
  sessionId: string
  amount: number
  method: PaymentMethod
  externalReference?: string
}) {
  return unwrap(
    await supabase.rpc('pos_record_payment', {
      p_session_id: input.sessionId,
      p_amount: input.amount,
      p_method: input.method,
      p_external_reference: input.externalReference || undefined,
    }),
  )
}

export async function transitionPosOrder(orderId: string, status: OrderStatus) {
  unwrap(await supabase.rpc('pos_transition_order', { p_order_id: orderId, p_status: status }))
}

/**
 * Abre la comanda de una mesa, o devuelve la que ya estaba abierta (MI-64).
 * La RPC es idempotente y usa la cuenta autenticada, no un PIN.
 */
export async function openPosTableSession(tableId: string) {
  const sessionId = unwrap(await supabase.rpc('pos_open_table_session', { p_table_id: tableId }))
  if (!sessionId) throw new AppError('SESSION_NOT_FOUND')
  return sessionId
}

export async function closePosSession(sessionId: string) {
  unwrap(await supabase.rpc('pos_close_table_session', { p_session_id: sessionId }))
}

/**
 * Marca atendida la solicitud de una mesa (MI-47). Idempotente: si otro mozo se
 * adelantó, la RPC devuelve null y no audita una atención de más.
 */
export async function resolvePosSessionRequest(sessionId: string, kind: SessionRequestKind) {
  unwrap(await supabase.rpc('pos_resolve_session_request', { p_session_id: sessionId, p_kind: kind }))
}

export async function movePosTableSession(
  sessionId: string,
  sourceTableId: string,
  destinationTableId: string,
) {
  unwrap(
    await supabase.rpc('pos_move_table_session', {
      p_session_id: sessionId,
      p_source_table_id: sourceTableId,
      p_destination_table_id: destinationTableId,
    }),
  )
}

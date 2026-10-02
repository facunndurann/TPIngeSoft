import { queryOptions, skipToken } from '@tanstack/react-query'
import {
  AppError,
  invokeFunction,
  submitOrderResultSchema,
  type SessionRequestKind,
  type SessionSplit,
  type SubmitOrderInput,
  type SubmitOrderResult,
  mobilePaymentResultSchema,
  type MobilePaymentRequest,
  type MobilePaymentResult,
  unwrap,
} from '@restaurant-platform/shared'
import { SESSION_POLL_MS, sessionKey } from '@/features/session'
import { supabase } from '@/lib/supabase'

export function submitOrder(input: SubmitOrderInput): Promise<SubmitOrderResult> {
  // El pedido pudo haberse creado aunque la respuesta sea ilegible: se conserva el
  // envío y reintentar con el mismo requestId devuelve su resultado sin duplicarlo.
  return invokeFunction(supabase, 'submit-order', input, submitOrderResultSchema, {
    unreadable: new AppError(
      'CONNECTION_ERROR',
      'No pudimos confirmar la respuesta. Reintentá el mismo envío para consultar su resultado.',
    ),
  })
}

export type AbandonResult = { outcome: 'abandoned' } | { outcome: 'already_submitted'; orderId: string }

/**
 * Descarta un envío con resultado desconocido. El servidor lo serializa con
 * submit_order: si el pedido ya se creó lo informa (no se puede descartar);
 * si no, garantiza que ese requestId nunca se convierta en pedido. Un rechazo
 * del catálogo (la mesa cerró, la sesión expiró) dice lo suyo; lo demás deja el
 * envío en duda y pide reintentar.
 */
export async function abandonSubmission(
  input: Pick<SubmitOrderInput, 'sessionId' | 'requestId'>,
): Promise<AbandonResult> {
  // Los tipos generados no expresan que la función devuelve null al descartar.
  const orderId: string | null = unwrap(
    await supabase.rpc('abandon_order_request', {
      p_session_id: input.sessionId,
      p_request_id: input.requestId,
    }),
    'No pudimos cancelar el envío porque todavía no sabemos si llegó. Revisá tu conexión y reintentá.',
  )
  return orderId ? { outcome: 'already_submitted', orderId } : { outcome: 'abandoned' }
}

export async function loadOrders(sessionId: string) {
  return unwrap(
    await supabase
      .from('orders')
      .select('*, order_items(*, order_item_modifiers(*), order_item_removed_ingredients(*))')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false }),
    'No pudimos actualizar los pedidos.',
  )
}

// Pedidos, cuenta y pagos cuelgan de la sesión: se refrescan con ella (ver sessionKey).
export function ordersQuery(sessionId: string | undefined) {
  return queryOptions({
    queryKey: [...sessionKey(sessionId), 'orders'],
    queryFn: sessionId ? () => loadOrders(sessionId) : skipToken,
    refetchInterval: SESSION_POLL_MS,
  })
}

export async function loadBill(sessionId: string) {
  return unwrap(
    await supabase.from('session_bills').select('*').eq('session_id', sessionId).single(),
    'No pudimos actualizar la cuenta.',
  )
}

export function billQuery(sessionId: string | undefined) {
  return queryOptions({
    queryKey: [...sessionKey(sessionId), 'bill'],
    queryFn: sessionId ? () => loadBill(sessionId) : skipToken,
    refetchInterval: SESSION_POLL_MS,
  })
}

/** Movimientos de la cuenta. El saldo se calcula aparte en session_bills. */
export async function loadPayments(sessionId: string) {
  return unwrap(
    await supabase
      .from('payments')
      .select(
        'id, participant_id, amount, refunded_amount, provider_status, mode, method, status, external_reference, created_at, payment_order_items(order_item_id)',
      )
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false }),
    'No pudimos actualizar el historial de pagos.',
  )
}

export function paymentsQuery(sessionId: string | undefined) {
  return queryOptions({
    queryKey: [...sessionKey(sessionId), 'payments'],
    queryFn: sessionId ? () => loadPayments(sessionId) : skipToken,
    refetchInterval: SESSION_POLL_MS,
  })
}

/** Solo disponibilidad efectiva; no expone ambiente, asociación ni credenciales. */
export function mobilePaymentAvailabilityQuery(sessionId: string | undefined) {
  return queryOptions({
    queryKey: [...sessionKey(sessionId), 'mobile-payment-availability'],
    queryFn: sessionId
      ? async () =>
          unwrap(
            await supabase.rpc('mobile_payment_available', { p_session_id: sessionId }),
            'No pudimos verificar si el pago desde el celular está disponible.',
          )
      : skipToken,
    refetchInterval: SESSION_POLL_MS,
  })
}

export function runMobilePayment(input: MobilePaymentRequest): Promise<MobilePaymentResult> {
  return invokeFunction(supabase, 'mobile-payment', input, mobilePaymentResultSchema)
}

/**
 * Pide la cuenta o que un mozo venga a cobrar (MI-38/MI-46). Es idempotente:
 * si ya había una solicitud viva devuelve su hora original sin crear otra.
 */
export async function requestSessionService(sessionId: string, kind: SessionRequestKind) {
  unwrap(await supabase.rpc('request_session_service', { p_session_id: sessionId, p_kind: kind }))
}

export async function updateSessionSplit(sessionId: string, split: SessionSplit) {
  unwrap(
    await supabase.rpc('update_session_split', {
      p_session_id: sessionId,
      p_split_type: split.type,
      p_allocations: split.allocations,
      p_equal_parts: split.equalParts,
    }),
  )
}

/**
 * Suma a la cuenta a alguien que no escaneó el QR y le pasa los ítems que
 * consumió, en una sola transacción: si algo falla no queda un invitado a medias,
 * así que reintentar no lo duplica. Devuelve el id del invitado.
 */
export async function addGuestParticipant(sessionId: string, name: string, itemIds: string[]) {
  return unwrap(
    await supabase.rpc('add_guest_participant', {
      p_session_id: sessionId,
      p_display_name: name,
      p_item_ids: itemIds,
    }),
  )
}

import { FunctionsHttpError } from '@supabase/supabase-js'
import { orderStatusLabels } from '@restaurant-platform/shared'
import type { OrderStatus, SubmitOrderInput } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

export class SubmissionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function readError(value: unknown): SubmissionError | undefined {
  if (typeof value !== 'object' || value === null || !('error' in value)) return
  const error = value.error
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  ) {
    return new SubmissionError(error.code, error.message)
  }
}

function isSubmitResult(
  data: unknown,
): data is { orderId: string; status: OrderStatus; totalAmount: number } {
  if (typeof data !== 'object' || data === null) return false
  if (!('orderId' in data) || typeof data.orderId !== 'string') return false
  if (!('status' in data) || typeof data.status !== 'string') return false
  if (!Object.prototype.hasOwnProperty.call(orderStatusLabels, data.status)) return false
  if (!('totalAmount' in data) || typeof data.totalAmount !== 'number') return false
  return Number.isFinite(data.totalAmount)
}

export async function submitOrder(input: SubmitOrderInput) {
  const { data, error } = await supabase.functions.invoke<unknown>('submit-order', { body: input })

  if (error) {
    if (error instanceof FunctionsHttpError) {
      let body: unknown
      try {
        body = await error.context.json()
      } catch {
        /* Keep the original request for a safe retry. */
      }
      const parsed = readError(body)
      if (parsed) throw parsed
    }
    throw new SubmissionError(
      'CONNECTION_ERROR',
      'No pudimos confirmar el envío. Reintentá: conservamos tu pedido para evitar duplicados.',
    )
  }

  const parsed = readError(data)
  if (parsed) throw parsed
  if (!isSubmitResult(data)) {
    throw new SubmissionError(
      'CONNECTION_ERROR',
      'No pudimos confirmar la respuesta. Reintentá el mismo envío para consultar su resultado.',
    )
  }
  return data
}

export type AbandonResult =
  | { outcome: 'abandoned' }
  | { outcome: 'already_submitted'; orderId: string }

/**
 * Descarta un envío con resultado desconocido. El servidor lo serializa con
 * submit_order: si el pedido ya se creó lo informa (no se puede descartar);
 * si no, garantiza que ese requestId nunca se convierta en pedido.
 */
export async function abandonSubmission(
  input: Pick<SubmitOrderInput, 'sessionId' | 'requestId'>,
): Promise<AbandonResult> {
  const { data, error } = await supabase.rpc('abandon_order_request', {
    p_session_id: input.sessionId,
    p_request_id: input.requestId,
  })
  if (error) {
    throw new SubmissionError(
      'CONNECTION_ERROR',
      'No pudimos cancelar el envío porque todavía no sabemos si llegó. Revisá tu conexión y reintentá.',
    )
  }
  // Los tipos generados no expresan que la función devuelve null al descartar.
  const orderId: string | null = data
  return orderId ? { outcome: 'already_submitted', orderId } : { outcome: 'abandoned' }
}

export async function loadOrders(sessionId: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*, order_item_modifiers(*), order_item_removed_ingredients(*))')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function loadBill(sessionId: string) {
  const { data, error } = await supabase
    .from('session_bills')
    .select('*')
    .eq('session_id', sessionId)
    .single()
  if (error) throw error
  return data
}

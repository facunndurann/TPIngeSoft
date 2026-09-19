import { FunctionsHttpError } from '@supabase/supabase-js'
import {
  submitOrderErrorSchema,
  submitOrderResultSchema,
  type SubmitOrderInput,
  type SubmitOrderResult,
} from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

export class SubmissionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function submitOrder(input: SubmitOrderInput): Promise<SubmitOrderResult> {
  const { data, error } = await supabase.functions.invoke<unknown>('submit-order', { body: input })

  if (error) {
    if (error instanceof FunctionsHttpError) {
      // Un cuerpo ilegible no es un rechazo del servidor: se conserva el envío para reintentar.
      const body = submitOrderErrorSchema.safeParse(await error.context.json().catch(() => null))
      if (body.success) throw new SubmissionError(body.data.error.code, body.data.error.message)
    }
    throw new SubmissionError(
      'CONNECTION_ERROR',
      'No pudimos confirmar el envío. Reintentá: conservamos tu pedido para evitar duplicados.',
    )
  }

  const result = submitOrderResultSchema.safeParse(data)
  if (!result.success) {
    throw new SubmissionError(
      'CONNECTION_ERROR',
      'No pudimos confirmar la respuesta. Reintentá el mismo envío para consultar su resultado.',
    )
  }
  return result.data
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

export async function updateSessionSplit(
  sessionId: string,
  splitType: 'none' | 'equal' | 'percentages',
  allocations: Record<string, number> = {}
) {
  const { error } = await supabase.rpc('update_session_split', {
    p_session_id: sessionId,
    p_split_type: splitType,
    p_allocations: allocations,
  })
  if (error) throw new SubmissionError('SPLIT_ERROR', 'No pudimos actualizar la división de la cuenta.')
}

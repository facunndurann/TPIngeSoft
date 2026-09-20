import { FunctionsHttpError } from '@supabase/supabase-js'
import {
  AppError,
  fromPostgres,
  isAppErrorCode,
  submitOrderErrorSchema,
  submitOrderResultSchema,
  type SessionSplit,
  type SubmitOrderInput,
  type SubmitOrderResult,
} from '@restaurant-platform/shared'
import { fromRead } from '@/features/api-errors'
import { supabase } from '@/lib/supabase'

export async function submitOrder(input: SubmitOrderInput): Promise<SubmitOrderResult> {
  const { data, error } = await supabase.functions.invoke<unknown>('submit-order', { body: input })

  if (error) {
    if (error instanceof FunctionsHttpError) {
      // Un cuerpo ilegible no es un rechazo del servidor: se conserva el envío para reintentar.
      const body = submitOrderErrorSchema.safeParse(await error.context.json().catch(() => null))
      // El mensaje viene del servidor, que ya lo tomó del mismo catálogo.
      if (body.success) {
        const { code, message } = body.data.error
        throw new AppError(isAppErrorCode(code) ? code : 'SERVER_ERROR', message)
      }
    }
    throw new AppError('CONNECTION_ERROR')
  }

  const result = submitOrderResultSchema.safeParse(data)
  if (!result.success) {
    throw new AppError(
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
    throw new AppError(
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
  if (error) throw fromRead(error, 'los pedidos')
  return data
}

export async function loadBill(sessionId: string) {
  const { data, error } = await supabase
    .from('session_bills')
    .select('*')
    .eq('session_id', sessionId)
    .single()
  if (error) throw fromRead(error, 'la cuenta')
  return data
}

export async function updateSessionSplit(sessionId: string, split: SessionSplit) {
  const { error } = await supabase.rpc('update_session_split', {
    p_session_id: sessionId,
    p_split_type: split.type,
    p_allocations: split.allocations,
  })
  if (error) throw fromPostgres(error)
}

import {
  AppError,
  mobilePaymentRequestSchema,
  uuidSchema,
  type MobilePaymentRequest,
} from '@restaurant-platform/shared'

type CreateRequest = Extract<MobilePaymentRequest, { action: 'create' }>
export type CheckoutAttempt = { request: CreateRequest; paymentId?: string }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export const checkoutAttemptKey = (sessionId: string, participantId: string) =>
  `checkout-pro:${sessionId}:${participantId}`

/** Solo conservamos identidad e ítems: importes, enlaces y estados siempre vienen del backend. */
export function readCheckoutAttempt(
  sessionId: string,
  participantId: string,
  storage?: Storage,
): CheckoutAttempt | undefined {
  try {
    const value: unknown = JSON.parse(
      (storage ?? window.sessionStorage).getItem(checkoutAttemptKey(sessionId, participantId)) ?? 'null',
    )
    if (!value || typeof value !== 'object' || !('request' in value)) return
    const request = mobilePaymentRequestSchema.safeParse(value.request)
    if (!request.success || request.data.action !== 'create' || request.data.sessionId !== sessionId) return
    const paymentId = 'paymentId' in value ? uuidSchema.safeParse(value.paymentId) : undefined
    if (paymentId && !paymentId.success) return
    return { request: request.data, ...(paymentId?.success ? { paymentId: paymentId.data } : {}) }
  } catch {
    return undefined
  }
}

export function saveCheckoutAttempt(participantId: string, attempt: CheckoutAttempt, storage?: Storage): void {
  try {
    ;(storage ?? window.sessionStorage).setItem(
      checkoutAttemptKey(attempt.request.sessionId, participantId),
      JSON.stringify(attempt),
    )
  } catch {
    // No iniciamos un cobro si no podemos conservar la misma solicitud tras una recarga.
    throw new AppError(
      'SERVER_ERROR',
      'No pudimos guardar el intento de pago. Habilitá el almacenamiento del navegador y reintentá.',
    )
  }
}

export function clearCheckoutAttempt(sessionId: string, participantId: string, storage?: Storage): void {
  try {
    ;(storage ?? window.sessionStorage).removeItem(checkoutAttemptKey(sessionId, participantId))
  } catch {
    // Un rastro viejo solo permite consultar el mismo pago; nunca aprobarlo o duplicarlo.
  }
}

import { InvalidWebhookSignatureError, WebhookSignatureValidator } from 'mercadopago'
import { z } from 'zod'
import { AppError } from '../../../packages/shared/src/errors.ts'
import { readJson } from '../_shared/http.ts'
import { paymentLog, verifyPayment, type CheckoutRepository, type ProviderFactory } from '../mobile-payment/checkout.ts'

const notification = z.object({
  type: z.string().max(80),
  data: z.object({ id: z.union([z.string().regex(/^\d{1,24}$/), z.number().int().positive().safe()]) }),
})
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const response = (status: number, code: string) => new Response(JSON.stringify({ code }), { status, headers })

export function createMercadoPagoWebhook(repository: CheckoutRepository, providerFor: ProviderFactory) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return response(405, 'METHOD_NOT_ALLOWED')
    let paymentId = ''
    try {
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return response(400, 'INVALID_REQUEST')
      }
      const url = new URL(request.url)
      paymentId = url.searchParams.get('payment_id') ?? ''
      const dataId = url.searchParams.get('data.id') ?? ''
      const requestId = request.headers.get('x-request-id')
      if (
        !z.string().uuid().safeParse(paymentId).success ||
        !/^\d{1,24}$/.test(dataId) ||
        !requestId ||
        !/^[\w-]{1,200}$/.test(requestId) ||
        url.searchParams.getAll('payment_id').length !== 1 ||
        url.searchParams.getAll('data.id').length !== 1
      ) {
        return response(400, 'INVALID_REQUEST')
      }
      const body = notification.safeParse(await readJson(request, 16 * 1024))
      if (
        !body.success ||
        String(body.data.data.id) !== dataId ||
        body.data.type !== 'payment' ||
        (url.searchParams.has('type') && url.searchParams.get('type') !== 'payment')
      ) {
        return response(400, 'INVALID_REQUEST')
      }
      const context = await repository.resolve(paymentId, null)
      if (!context.webhook_secret) return response(503, 'PAYMENT_PROVIDER_UNAVAILABLE')
      WebhookSignatureValidator.validate({
        xSignature: request.headers.get('x-signature'),
        xRequestId: requestId,
        dataId,
        secret: context.webhook_secret,
        // Authentic retries can arrive much later. HMAC + GET + idempotent persistence handles replay.
      })
      if (!context.collector_id) return response(503, 'CHECKOUT_IN_PROGRESS')
      const payment = await providerFor(context.access_token).getPayment(dataId)
      if (String(payment.id) !== dataId) throw new AppError('PAYMENT_VERIFICATION_FAILED')
      await repository.apply(context, verifyPayment(context, payment))
      paymentLog('webhook.processed', paymentId)
      // Acknowledge only after the durable transaction commits; failures ask MP to retry.
      return response(200, 'OK')
    } catch (error) {
      if (error instanceof InvalidWebhookSignatureError) return response(401, 'INVALID_SIGNATURE')
      const code = error instanceof AppError ? error.code : 'PAYMENT_PROVIDER_UNAVAILABLE'
      paymentLog('webhook.failed', paymentId, code)
      const status = error instanceof AppError ? error.status : 503
      return response(status, code)
    }
  }
}

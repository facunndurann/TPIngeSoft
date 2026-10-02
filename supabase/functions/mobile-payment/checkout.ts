import { AppError } from '../../../packages/shared/src/errors.ts'
import {
  isMercadoPagoCheckoutUrl,
  type MobilePaymentRequest,
  type MobilePaymentResult,
  type PaymentStatus,
} from '../../../packages/shared/src/payments.ts'

/** Contratos internos de la aplicación. Los campos del proveedor se documentan en docs/MERCADO_PAGO.md. */
export type CheckoutContext = {
  payment_id: string
  amount: number
  status: PaymentStatus
  currency_id: string
  external_reference: string
  environment: 'test' | 'production'
  access_token: string
  webhook_secret: string
  checkout_state: string
  lease_token: string
  preference_id: string | null
  checkout_url: string | null
  collector_id: string | null
  mp_payment_id: string | null
  provider_status: string | null
  session_id: string
  restaurant_id: string
  branch_id: string
  qr_token: string
}

export type PreferenceData = {
  id?: string
  init_point?: string
  external_reference?: string
  collector_id?: number
  items?: { quantity: number; unit_price: number; currency_id?: string }[]
}

export type ProviderPayment = {
  id?: number | string
  external_reference?: string
  collector_id?: number | string
  currency_id?: string
  transaction_amount?: number
  transaction_amount_refunded?: number
  status?: string
  date_last_updated?: string
}

export type CheckoutSettings = { appUrl: string; webhookUrl: string }

export interface CheckoutProvider {
  create(context: CheckoutContext, settings: CheckoutSettings): Promise<PreferenceData>
  findPreference(reference: string): Promise<PreferenceData | null>
  findPayments(reference: string): Promise<ProviderPayment[]>
  getPayment(id: string): Promise<ProviderPayment>
}

export interface CheckoutRepository {
  rateLimit(userId: string, action: 'create' | 'status'): Promise<void>
  create(input: Extract<MobilePaymentRequest, { action: 'create' }>): Promise<string>
  claim(paymentId: string, userId: string): Promise<CheckoutContext>
  resolve(paymentId: string, userId: string | null): Promise<CheckoutContext>
  complete(
    context: CheckoutContext,
    preference: Required<Pick<PreferenceData, 'id' | 'init_point' | 'collector_id'>>,
  ): Promise<void>
  fail(context: CheckoutContext, definitive: boolean): Promise<void>
  apply(context: CheckoutContext, payment: VerifiedPayment): Promise<void>
}

export type VerifiedPayment = Required<ProviderPayment>
export type ProviderFactory = (token: string) => CheckoutProvider

// Local operational logs deliberately exclude credentials, provider bodies and payer details.
export const paymentLog = (event: string, paymentId: string, code?: string) =>
  console.info(JSON.stringify({ event, paymentId, ...(code ? { code } : {}) }))

export function checkoutSettings(appUrl: string | undefined, webhookUrl: string | undefined): CheckoutSettings {
  try {
    const app = new URL(appUrl ?? '')
    const webhook = new URL(webhookUrl ?? '')
    for (const url of [app, webhook]) {
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error()
    }
    if (app.pathname !== '/' || webhook.pathname !== '/functions/v1/mercado-pago-webhook') throw new Error()
    return { appUrl: app.origin, webhookUrl: webhook.href }
  } catch {
    throw new Error('Configure MERCADO_PAGO_APP_URL and MERCADO_PAGO_WEBHOOK_URL with public HTTPS URLs')
  }
}

function cents(value: number) {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 99999999.99 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 0.00001
  ) {
    throw new AppError('PAYMENT_VERIFICATION_FAILED')
  }
  return Math.round(value * 100)
}

export function validatePreference(context: CheckoutContext, preference: PreferenceData) {
  if (
    !preference.id ||
    !/^[\w-]{1,200}$/.test(preference.id) ||
    !preference.init_point ||
    !isMercadoPagoCheckoutUrl(preference.init_point) ||
    preference.external_reference !== context.external_reference ||
    !Number.isSafeInteger(preference.collector_id) ||
    Number(preference.collector_id) <= 0 ||
    !preference.items?.length ||
    preference.items.some(
      (item) => item.currency_id !== context.currency_id || !Number.isSafeInteger(item.quantity) || item.quantity <= 0,
    ) ||
    preference.items.reduce((total, item) => total + cents(item.unit_price) * item.quantity, 0) !==
      cents(Number(context.amount))
  )
    throw new AppError('PAYMENT_VERIFICATION_FAILED')
  return { id: preference.id, init_point: preference.init_point, collector_id: preference.collector_id! }
}

/** Se valida la respuesta obtenida con el token del receptor, nunca el cuerpo del webhook ni back_urls. */
export function verifyPayment(context: CheckoutContext, payment: ProviderPayment): VerifiedPayment {
  const statuses = [
    'pending',
    'authorized',
    'in_process',
    'in_mediation',
    'approved',
    'rejected',
    'cancelled',
    'refunded',
    'charged_back',
  ]
  const refunded = payment.transaction_amount_refunded ?? 0
  if (
    !/^[1-9]\d{0,23}$/.test(String(payment.id)) ||
    (typeof payment.id === 'number' && !Number.isSafeInteger(payment.id)) ||
    !context.collector_id ||
    String(payment.collector_id) !== context.collector_id ||
    payment.external_reference !== context.external_reference ||
    payment.currency_id !== context.currency_id ||
    payment.transaction_amount === undefined ||
    cents(payment.transaction_amount) !== cents(Number(context.amount)) ||
    cents(refunded) > cents(Number(context.amount)) ||
    !payment.status ||
    !statuses.includes(payment.status) ||
    !payment.date_last_updated ||
    !Number.isFinite(Date.parse(payment.date_last_updated))
  )
    throw new AppError('PAYMENT_VERIFICATION_FAILED')
  return { ...payment, transaction_amount_refunded: refunded } as VerifiedPayment
}

function result(context: CheckoutContext): MobilePaymentResult {
  return {
    paymentId: context.payment_id,
    amount: Number(context.amount),
    status: context.status,
    ...(context.status === 'pending' && context.checkout_url ? { checkoutUrl: context.checkout_url } : {}),
    ...(context.preference_id ? { preferenceId: context.preference_id } : {}),
    ...(context.provider_status ? { providerStatus: context.provider_status } : {}),
  }
}

function definitiveRejection(error: unknown) {
  if (!error || typeof error !== 'object' || !('status' in error)) return false
  return [400, 401, 403, 422].includes(Number(error.status))
}

export async function ensurePreference(
  context: CheckoutContext,
  repository: CheckoutRepository,
  provider: CheckoutProvider,
  settings: CheckoutSettings,
) {
  if (context.preference_id || context.status !== 'pending') return
  if (!context.webhook_secret || !context.qr_token) {
    // No remote request has happened, so this reservation can be released safely.
    if (context.checkout_state === 'creating') await repository.fail(context, true)
    throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE')
  }
  if (context.checkout_state === 'uncertain') {
    const found = await provider.findPreference(context.external_reference)
    if (!found) throw new AppError('CHECKOUT_UNCERTAIN')
    await repository.complete(context, validatePreference(context, found))
    paymentLog('checkout.recovered', context.payment_id)
    return
  }
  if (context.checkout_state !== 'creating') throw new AppError('CHECKOUT_UNCERTAIN')
  let preference: PreferenceData
  try {
    preference = await provider.create(context, settings)
  } catch (error) {
    await repository.fail(context, definitiveRejection(error))
    paymentLog('checkout.create_failed', context.payment_id, definitiveRejection(error) ? 'rejected' : 'uncertain')
    throw new AppError(definitiveRejection(error) ? 'PAYMENT_PROVIDER_UNAVAILABLE' : 'CHECKOUT_UNCERTAIN')
  }
  // A successful POST followed by validation/DB failure is always uncertain, never safe to POST again.
  try {
    await repository.complete(context, validatePreference(context, preference))
  } catch (error) {
    await repository.fail(context, false)
    throw error
  }
  paymentLog('checkout.created', context.payment_id)
}

export function checkoutGateway(
  repository: CheckoutRepository,
  providerFor: ProviderFactory,
  settings: CheckoutSettings,
  userId: string,
) {
  return {
    async execute(input: MobilePaymentRequest): Promise<MobilePaymentResult> {
      await repository.rateLimit(userId, input.action)
      const paymentId = input.action === 'create' ? await repository.create(input) : input.paymentId
      let context = await repository.claim(paymentId, userId)
      const provider = providerFor(context.access_token)
      await ensurePreference(context, repository, provider, settings)
      context = await repository.resolve(paymentId, userId)
      if (input.action === 'status' && context.preference_id) {
        const payments = await provider.findPayments(context.external_reference)
        // Earlier attempts first; DB protects confirmed payments and detects a second approval.
        payments.sort((a, b) => Date.parse(a.date_last_updated ?? '') - Date.parse(b.date_last_updated ?? ''))
        for (const payment of payments) await repository.apply(context, verifyPayment(context, payment))
        context = await repository.resolve(paymentId, userId)
      }
      return result(context)
    },
  }
}

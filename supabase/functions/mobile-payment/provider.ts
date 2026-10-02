import { MercadoPagoConfig, Payment, Preference } from 'mercadopago'
import { AppError } from '../../../packages/shared/src/errors.ts'
import type { CheckoutProvider } from './checkout.ts'

/** Official SDK 3.6.1; each call uses only the immutable credential of this payment's restaurant. */
export function mercadoPagoProvider(accessToken: string): CheckoutProvider {
  // No automatic POST retries: Preferences does not document idempotency guarantees.
  const config = new MercadoPagoConfig({ accessToken, options: { timeout: 5000, maxRetries: 0 } })
  const preferences = new Preference(config)
  const payments = new Payment(config)
  return {
    create(context, settings) {
      const back = `${settings.appUrl}/m/${encodeURIComponent(context.qr_token)}/cuenta`
      const notification = new URL(settings.webhookUrl)
      notification.searchParams.set('payment_id', context.payment_id)
      return preferences.create({
        body: {
          items: [
            {
              id: context.payment_id,
              title: 'Consumo en restaurante',
              quantity: 1,
              unit_price: Number(context.amount),
              currency_id: context.currency_id,
            },
          ],
          external_reference: context.external_reference,
          back_urls: { success: back, failure: back, pending: back },
          auto_return: 'approved',
          notification_url: notification.href,
        },
        requestOptions: { idempotencyKey: context.payment_id },
      })
    },
    async findPreference(reference) {
      const response = await preferences.search({ options: { external_reference: reference, limit: 2 } })
      const matches = response.elements?.filter((item) => item.external_reference === reference) ?? []
      if ((response.total ?? matches.length) > 1 || matches.length > 1)
        throw new AppError('PAYMENT_RECONCILIATION_REQUIRED')
      return matches[0] ? preferences.get({ preferenceId: matches[0].id }) : null
    },
    async findPayments(reference) {
      const response = await payments.search({
        options: { external_reference: reference, limit: 50, sort: 'date_last_updated', criteria: 'asc' },
      })
      if ((response.paging?.total ?? 0) > 50) throw new AppError('PAYMENT_RECONCILIATION_REQUIRED')
      return response.results ?? []
    },
    getPayment(id) {
      return payments.get({ id })
    },
  }
}

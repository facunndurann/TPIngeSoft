import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../packages/shared/src/database.types.ts'
import { AppError } from '../../../packages/shared/src/errors.ts'
import { unwrap } from '../../../packages/shared/src/supabase-client.ts'
import type { CheckoutContext, CheckoutRepository } from './checkout.ts'

export function checkoutRepository(
  admin: SupabaseClient<Database>,
  caller?: SupabaseClient<Database>,
): CheckoutRepository {
  const context = (rows: CheckoutContext[]): CheckoutContext => {
    if (!rows[0]) throw new AppError('PAYMENT_NOT_FOUND')
    return rows[0]
  }
  return {
    async rateLimit(userId, action) {
      unwrap(await admin.rpc('consume_payment_rate_limit', { p_user_id: userId, p_action: action }))
    },
    async create(input) {
      if (!caller) throw new AppError('AUTH_REQUIRED')
      const rows = unwrap(
        await caller.rpc('create_mobile_payment', {
          p_session_id: input.sessionId,
          p_request_id: input.requestId,
          p_mode: input.mode,
          p_item_ids: input.itemIds,
        }),
      )
      if (!rows[0]) throw new AppError('PAYMENT_NOT_FOUND')
      return rows[0].payment_id
    },
    async claim(paymentId, userId) {
      return context(unwrap(await admin.rpc('claim_mobile_checkout', { p_payment_id: paymentId, p_user_id: userId })))
    },
    async resolve(paymentId, userId) {
      return context(
        unwrap(
          await admin.rpc('resolve_payment_provider_for_payment', {
            p_payment_id: paymentId,
            ...(userId ? { p_user_id: userId } : {}),
          }),
        ),
      )
    },
    async complete(checkout, preference) {
      unwrap(
        await admin.rpc('complete_mobile_checkout', {
          p_payment_id: checkout.payment_id,
          p_lease_token: checkout.lease_token,
          p_preference_id: preference.id,
          p_checkout_url: preference.init_point,
          p_collector_id: String(preference.collector_id),
        }),
      )
    },
    async fail(checkout, definitive) {
      unwrap(
        await admin.rpc('fail_mobile_checkout', {
          p_payment_id: checkout.payment_id,
          p_lease_token: checkout.lease_token,
          p_definitive: definitive,
        }),
      )
    },
    async apply(checkout, payment) {
      unwrap(
        await admin.rpc('apply_mercado_pago_payment', {
          p_payment_id: checkout.payment_id,
          p_provider_payment_id: String(payment.id),
          p_external_reference: payment.external_reference,
          p_amount: payment.transaction_amount,
          p_currency_id: payment.currency_id,
          p_provider_status: payment.status,
          p_provider_updated_at: payment.date_last_updated,
          p_refunded_amount: payment.transaction_amount_refunded,
        }),
      )
    },
  }
}

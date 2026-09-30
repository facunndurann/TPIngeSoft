import { queryOptions } from '@tanstack/react-query'
import {
  paymentProviderConfigInputSchema,
  type PaymentProviderConfig,
  type PaymentProviderConfigInput,
  unwrap,
} from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

export const paymentProviderKey = (restaurantId: string) => ['payment-provider', restaurantId] as const

export const paymentProviderQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: paymentProviderKey(restaurantId),
    queryFn: async (): Promise<PaymentProviderConfig> => {
      const [row] = unwrap(
        await supabase.rpc('get_payment_provider_config', {
          p_restaurant_id: restaurantId,
        }),
      )
      if (!row) throw new Error('No pudimos consultar la configuración de Mercado Pago.')
      return {
        provider: row.provider,
        environment: row.environment,
        configured: row.configured,
        accessTokenHint: row.access_token_hint,
        webhookConfigured: row.webhook_configured,
        branchIds: row.branch_ids,
        updatedAt: row.updated_at,
      }
    },
  })

export async function savePaymentProvider(input: PaymentProviderConfigInput) {
  const parsed = paymentProviderConfigInputSchema.parse(input)
  unwrap(
    await supabase.rpc('save_payment_provider_config', {
      p_restaurant_id: parsed.restaurantId,
      p_environment: parsed.environment,
      p_branch_ids: parsed.branchIds,
      p_access_token: parsed.accessToken,
      p_webhook_secret: parsed.webhookSecret,
    }),
  )
}

export async function deletePaymentProvider(restaurantId: string) {
  unwrap(
    await supabase.rpc('delete_payment_provider_config', {
      p_restaurant_id: restaurantId,
    }),
  )
}

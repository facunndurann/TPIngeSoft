import { queryOptions } from '@tanstack/react-query'
import { unwrap } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

export async function loadMobilePayments(restaurantId: string, reviewOnly: boolean) {
  let query = supabase
    .from('payments')
    .select(
      'id, session_id, amount, refunded_amount, status, provider_status, mp_payment_id, reconciliation_issue, created_at, updated_at',
    )
    .eq('restaurant_id', restaurantId)
    .eq('method', 'mobile')
  if (reviewOnly) query = query.not('reconciliation_issue', 'is', null)
  return unwrap(
    await query.order('updated_at', { ascending: false }).limit(50),
    'No pudimos actualizar los pagos de Mercado Pago.',
  )
}

export const mobilePaymentsQuery = (restaurantId: string, reviewOnly = false) =>
  queryOptions({
    queryKey: ['mobile-payments', restaurantId, reviewOnly],
    queryFn: () => loadMobilePayments(restaurantId, reviewOnly),
    refetchInterval: 30_000,
  })

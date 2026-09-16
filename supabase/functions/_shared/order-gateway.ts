import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/shared/src/database.types.ts';
import type { SubmitOrderInput, SubmitOrderResult } from '../../../packages/shared/src/orders.ts';
import { databaseError, OrderError } from './errors.ts';

export interface OrderGateway {
  submit(input: SubmitOrderInput): Promise<SubmitOrderResult>;
}

export async function authenticateOrderGateway(url: string, anonKey: string, jwt: string): Promise<OrderGateway> {
  const client = createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // Validate with Auth, including anonymous sign-ins; never trust an unverified JWT payload.
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) throw new OrderError('AUTH_REQUIRED');
  return {
    async submit(input) {
      // Una sola transacción valida, guarda y (con el POS interno) acepta el pedido.
      // Reintentar el mismo requestId devuelve el pedido ya guardado.
      const { data: order, error } = await client.rpc('submit_order', {
        p_session_id: input.sessionId,
        p_request_id: input.requestId,
        p_items: input.items,
        p_expected_total: input.expectedTotal,
        ...(input.notes === undefined ? {} : { p_notes: input.notes }),
      });
      if (error) throw databaseError(error);
      return { orderId: order.id, status: order.status, totalAmount: order.total_amount };
    },
  };
}

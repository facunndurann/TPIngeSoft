import { unwrap } from '../../../packages/shared/src/supabase-client.ts'
import { callerClient, verifiedUser } from '../_shared/clients.ts'
import type { OrderGateway } from './handler.ts'

/** Acceso a Postgres con el JWT verificado del comensal, anónimo incluido; no usa service role. */
export async function authenticateOrderGateway(url: string, anonKey: string, jwt: string): Promise<OrderGateway> {
  const client = callerClient(url, anonKey, jwt)
  await verifiedUser(client, jwt)

  return {
    async submit(input) {
      // Una sola transacción valida, guarda y (con el POS interno) acepta el pedido.
      // Reintentar el mismo requestId devuelve el pedido ya guardado.
      const order = unwrap(await client.rpc('submit_order', {
        p_session_id: input.sessionId,
        p_request_id: input.requestId,
        p_items: input.items,
        p_expected_total: input.expectedTotal,
        ...(input.notes === undefined ? {} : { p_notes: input.notes }),
      }))
      return { orderId: order.id, status: order.status, totalAmount: order.total_amount }
    },
  }
}

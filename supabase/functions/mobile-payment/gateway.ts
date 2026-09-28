import { AppError } from '../../../packages/shared/src/errors.ts'
import type { MobilePaymentResult, PaymentStatus } from '../../../packages/shared/src/payments.ts'
import { unwrap } from '../../../packages/shared/src/supabase-client.ts'
import { adminClient, callerClient, verifiedUser } from '../_shared/clients.ts'
import type { MobilePaymentGateway } from './handler.ts'

type PaymentRow = { payment_id: string; amount: number; status: PaymentStatus }

/** Las dos RPCs devuelven el pago en una tabla de una fila. */
const paymentResult = ([row]: PaymentRow[]): MobilePaymentResult => ({
  paymentId: row.payment_id,
  amount: Number(row.amount),
  status: row.status,
})

export async function authenticateMobilePayment(
  url: string,
  anonKey: string,
  serviceKey: string,
  jwt: string,
  sandbox: boolean,
): Promise<MobilePaymentGateway> {
  const caller = callerClient(url, anonKey, jwt)
  const user = await verifiedUser(caller, jwt)
  // Paga el comensal que entró por el QR, que tiene una sesión anónima.
  if (!user.is_anonymous) throw new AppError('AUTH_REQUIRED')
  const admin = adminClient(url, serviceKey)

  return {
    async execute(input) {
      if (input.action === 'create') {
        return paymentResult(unwrap(await caller.rpc('create_mobile_payment', {
          p_session_id: input.sessionId,
          p_request_id: input.requestId,
          p_mode: input.mode,
          p_item_ids: input.itemIds,
        })))
      }
      // Confirmar es cosa del proveedor; mientras no haya uno real, solo el simulador.
      if (!sandbox) throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE')
      return paymentResult(unwrap(await admin.rpc('resolve_mobile_payment', {
        p_payment_id: input.paymentId,
        p_user_id: user.id,
        p_status: input.outcome,
      })))
    },
  }
}

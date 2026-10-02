import {
  mobilePaymentRequestSchema,
  type MobilePaymentRequest,
  type MobilePaymentResult,
} from '../../../packages/shared/src/payments.ts'
import { postHandler, reply } from '../_shared/http.ts'

export interface MobilePaymentGateway {
  execute(input: MobilePaymentRequest): Promise<MobilePaymentResult>
}

export function createMobilePaymentHandler(authenticate: (jwt: string) => Promise<MobilePaymentGateway>) {
  return postHandler({
    schema: mobilePaymentRequestSchema,
    maxBytes: 16 * 1024,
    authenticate,
    messages: { METHOD_NOT_ALLOWED: 'Usá POST para iniciar un pago.' },
    // El navegador inicia o consulta; solo el proveedor puede confirmar un pago.
    run: async (input, gateway) => reply(await gateway.execute(input), input.action === 'create' ? 201 : 200),
  })
}

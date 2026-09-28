import { submitOrderSchema, type SubmitOrderInput, type SubmitOrderResult } from '../../../packages/shared/src/orders.ts'
import { postHandler, reply } from '../_shared/http.ts'

export interface OrderGateway {
  submit(input: SubmitOrderInput): Promise<SubmitOrderResult>
}

export function createSubmitOrderHandler(authenticate: (jwt: string) => Promise<OrderGateway>) {
  return postHandler({
    schema: submitOrderSchema,
    // Hasta 50 líneas, cada una con sus opciones e ingredientes quitados.
    maxBytes: 128 * 1024,
    authenticate,
    messages: {
      // Una falla inesperada durante un envío deja el resultado en duda, y el
      // mensaje genérico del catálogo no alcanza: acá hay que pedir el reintento
      // del mismo envío, que es lo único que evita el pedido duplicado.
      SERVER_ERROR: 'No pudimos confirmar el resultado. Reintentá el mismo envío para evitar duplicados.',
    },
    run: async (input, gateway) => reply(await gateway.submit(input)),
  })
}

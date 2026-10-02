import { AppError } from '../../../packages/shared/src/errors.ts'
import { adminClient, callerClient, verifiedUser } from '../_shared/clients.ts'
import { checkoutGateway, type CheckoutSettings } from './checkout.ts'
import { checkoutRepository } from './repository.ts'
import { mercadoPagoProvider } from './provider.ts'

export async function authenticateMobilePayment(
  url: string,
  anonKey: string,
  serviceKey: string,
  jwt: string,
  settings: CheckoutSettings,
) {
  const caller = callerClient(url, anonKey, jwt)
  const user = await verifiedUser(caller, jwt)
  if (!user.is_anonymous) throw new AppError('AUTH_REQUIRED')
  return checkoutGateway(
    checkoutRepository(adminClient(url, serviceKey), caller),
    mercadoPagoProvider,
    settings,
    user.id,
  )
}

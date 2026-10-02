import { authenticateMobilePayment } from './gateway.ts'
import { createMobilePaymentHandler } from './handler.ts'
import { checkoutSettings } from './checkout.ts'

const url = Deno.env.get('SUPABASE_URL')
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !anonKey || !serviceKey) throw new Error('Missing Supabase runtime configuration')
const settings = checkoutSettings(Deno.env.get('MERCADO_PAGO_APP_URL'), Deno.env.get('MERCADO_PAGO_WEBHOOK_URL'))

Deno.serve(createMobilePaymentHandler((jwt) => authenticateMobilePayment(url, anonKey, serviceKey, jwt, settings)))

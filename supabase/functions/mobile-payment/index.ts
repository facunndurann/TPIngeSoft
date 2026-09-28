import { authenticateMobilePayment } from './gateway.ts'
import { createMobilePaymentHandler } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !anonKey || !serviceKey) throw new Error('Missing Supabase runtime configuration')
const sandbox = Deno.env.get('PAYMENT_SANDBOX_ENABLED') === 'true'

Deno.serve(createMobilePaymentHandler((jwt) => authenticateMobilePayment(url, anonKey, serviceKey, jwt, sandbox)))

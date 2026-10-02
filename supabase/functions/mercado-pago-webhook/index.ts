import { adminClient } from '../_shared/clients.ts'
import { checkoutRepository } from '../mobile-payment/repository.ts'
import { mercadoPagoProvider } from '../mobile-payment/provider.ts'
import { createMercadoPagoWebhook } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('Missing Supabase runtime configuration')
Deno.serve(createMercadoPagoWebhook(checkoutRepository(adminClient(url, serviceKey)), mercadoPagoProvider))

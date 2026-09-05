import { authenticateOrderGateway } from '../_shared/order-gateway.ts';
import { createSubmitOrderHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
if (!url || !anonKey) throw new Error('Missing Supabase runtime configuration');

Deno.serve(createSubmitOrderHandler(jwt => authenticateOrderGateway(url, anonKey, jwt)));

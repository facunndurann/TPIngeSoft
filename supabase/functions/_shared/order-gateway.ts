import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/shared/src/database.types.ts';
import { databaseError } from './errors.ts';
import type { OrderGateway } from './pos/adapter.ts';

export async function authenticateOrderGateway(url: string, anonKey: string, jwt: string): Promise<OrderGateway> {
  const client = createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // Validate with Auth, including anonymous sign-ins; never trust an unverified JWT payload.
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) throw databaseError({ message: 'AUTH_REQUIRED' });
  return {
    async submit(input) {
      const { data, error } = await client.rpc('submit_order', {
        p_session_id: input.sessionId,
        p_request_id: input.requestId,
        p_items: input.items,
        p_expected_total: input.expectedTotal,
        ...(input.notes === undefined ? {} : { p_notes: input.notes }),
      });
      if (error) throw databaseError(error);
      if (!data) throw databaseError({ message: 'ORDER_NOT_FOUND' });
      return data;
    },
    async loadOrder(id) {
      const { data, error } = await client.from('orders').select(
        '*,order_items(*,order_item_modifiers(*),order_item_removed_ingredients(*)),table_sessions!inner(table_id,tables!inner(id,label))',
      ).eq('id', id).single();
      if (error) throw databaseError(error);
      return data;
    },
    async posType(id) {
      const { data, error } = await client.rpc('get_order_pos_type', { p_order_id: id });
      if (error) throw databaseError(error);
      return data;
    },
    async dispatchInternal(id) {
      const { error } = await client.rpc('dispatch_internal_order', { p_order_id: id });
      if (error) throw databaseError(error);
    },
  };
}

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/shared/src/database.types.ts';
import { AppError, fromPostgres } from '../../../packages/shared/src/errors.ts';
import type { MobilePaymentRequest, MobilePaymentResult, PaymentStatus } from '../../../packages/shared/src/payments.ts';
import type { MobilePaymentGateway } from './handler.ts';

type PaymentRow = { payment_id: string; amount: number; status: PaymentStatus };
const result = (row: PaymentRow): MobilePaymentResult => ({
  paymentId: row.payment_id, amount: Number(row.amount), status: row.status,
});

export async function authenticateMobilePayment(
  url: string, anonKey: string, serviceKey: string, jwt: string, sandbox: boolean,
): Promise<MobilePaymentGateway> {
  const caller=createClient<Database>(url,anonKey,{
    global:{headers:{Authorization:`Bearer ${jwt}`}},
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  });
  const {data,error}=await caller.auth.getUser(jwt);
  if (error||!data.user||!data.user.is_anonymous) throw new AppError('AUTH_REQUIRED');
  const admin=createClient<Database>(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  return {
    async execute(input: MobilePaymentRequest) {
      if (input.action==='create') {
        const {data:rows,error}=await caller.rpc('create_mobile_payment',{
          p_session_id:input.sessionId,p_request_id:input.requestId,
        });
        if (error) throw fromPostgres(error);
        return result(rows[0] as PaymentRow);
      }
      if (!sandbox) throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE');
      const {data:rows,error}=await admin.rpc('resolve_mobile_payment',{
        p_payment_id:input.paymentId,p_user_id:data.user.id,p_status:input.outcome,
      });
      if (error) throw fromPostgres(error);
      return result(rows[0] as PaymentRow);
    },
  };
}

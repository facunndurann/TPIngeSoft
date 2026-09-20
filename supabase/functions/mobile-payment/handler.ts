import { AppError } from '../../../packages/shared/src/errors.ts';
import {
  mobilePaymentRequestSchema,
  type MobilePaymentRequest,
  type MobilePaymentResult,
} from '../../../packages/shared/src/payments.ts';

export interface MobilePaymentGateway {
  execute(input: MobilePaymentRequest): Promise<MobilePaymentResult>;
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {
  status, headers: { ...headers, 'Content-Type': 'application/json' },
});

export function createMobilePaymentHandler(authenticate: (jwt: string) => Promise<MobilePaymentGateway>) {
  return async (request: Request): Promise<Response> => {
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
    if (request.method!=='POST') return json({error:{code:'METHOD_NOT_ALLOWED',message:'Usá POST para iniciar un pago.'}},405);
    try {
      const token=request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!token) throw new AppError('AUTH_REQUIRED');
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
        throw new AppError('INVALID_REQUEST');
      const text=await request.text();
      if (text.length>16_384) throw new AppError('PAYLOAD_TOO_LARGE');
      let body: unknown;
      try { body=JSON.parse(text); } catch { throw new AppError('INVALID_REQUEST'); }
      const parsed=mobilePaymentRequestSchema.safeParse(body);
      if (!parsed.success) throw new AppError('INVALID_REQUEST');
      const gateway=await authenticate(token);
      return json(await gateway.execute(parsed.data),parsed.data.action==='create'?201:200);
    } catch (error) {
      const appError=error instanceof AppError ? error : new AppError('SERVER_ERROR');
      return json({error:{code:appError.code,message:appError.message}},appError.status);
    }
  };
}

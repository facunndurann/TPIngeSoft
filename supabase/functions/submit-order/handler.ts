import { submitOrderSchema } from '../../../packages/shared/src/orders.ts';
import { databaseError, OrderError } from '../_shared/errors.ts';
import type { OrderGateway } from '../_shared/order-gateway.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...headers, 'Content-Type': 'application/json' },
});

async function readBody(request: Request): Promise<unknown> {
  const limit = 128 * 1024;
  const reader = request.body?.getReader();
  if (!reader) throw databaseError({ message: 'INVALID_REQUEST' });
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new OrderError('PAYLOAD_TOO_LARGE', 413, 'El pedido es demasiado grande.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw databaseError({ message: 'INVALID_REQUEST' }); }
}

export function createSubmitOrderHandler(authenticate: (jwt: string) => Promise<OrderGateway>) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Usá POST para enviar un pedido.' } }, 405);
    try {
      const token = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!token) throw databaseError({ message: 'AUTH_REQUIRED' });
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw databaseError({ message: 'INVALID_REQUEST' });
      }
      const parsed = submitOrderSchema.safeParse(await readBody(request));
      if (!parsed.success) throw databaseError({ message: 'INVALID_REQUEST' });
      const gateway = await authenticate(token);
      return json(await gateway.submit(parsed.data));
    } catch (error) {
      const failure = error instanceof OrderError ? error : databaseError({ message: 'UNKNOWN' });
      return json({ error: { code: failure.code, message: failure.message } }, failure.status);
    }
  };
}

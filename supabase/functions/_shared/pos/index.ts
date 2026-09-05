import { databaseError } from '../errors.ts';
import type { OrderGateway, PosAdapter } from './adapter.ts';
import { InternalPosAdapter } from './internal.ts';

export function createPosAdapter(type: string, gateway: OrderGateway): PosAdapter {
  switch (type) {
    case 'internal': return new InternalPosAdapter(gateway);
    default: throw databaseError({ message: 'POS_UNSUPPORTED' });
  }
}

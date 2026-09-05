import type { OrderGateway, PosAdapter, PosOrder } from './adapter.ts';

export class InternalPosAdapter implements PosAdapter {
  constructor(private gateway: OrderGateway) {}

  async sendOrder(order: PosOrder) {
    // One transaction records receipt, timestamp and log; repeated delivery is a no-op.
    await this.gateway.dispatchInternal(order.id);
    const received = await this.gateway.loadOrder(order.id);
    return { orderId: received.id, status: received.status };
  }
}

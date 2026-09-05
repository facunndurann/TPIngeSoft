import type { OrderStatus, SubmitOrderInput } from '../../../../packages/shared/src/orders.ts';
import type { Tables } from '../../../../packages/shared/src/database.types.ts';

/** Complete internal snapshot. External adapters translate this to their POS model. */
export type PosOrder = Tables<'orders'> & {
  order_items: Array<Tables<'order_items'> & {
    order_item_modifiers: Tables<'order_item_modifiers'>[];
    order_item_removed_ingredients: Tables<'order_item_removed_ingredients'>[];
  }>;
  table_sessions: { table_id: string; tables: { id: string; label: string } };
};

export interface OrderGateway {
  submit(input: SubmitOrderInput): Promise<string>;
  loadOrder(id: string): Promise<PosOrder>;
  posType(id: string): Promise<string>;
  dispatchInternal(id: string): Promise<void>;
}

export interface PosAdapter {
  sendOrder(order: PosOrder): Promise<{ orderId: string; status: OrderStatus }>;
}

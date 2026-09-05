import { z } from 'zod';
import type { Database } from './database.types.ts';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const selectionIds = z.array(uuid).max(100).refine(
  ids => new Set(ids).size === ids.length,
  'No se puede elegir la misma opción o ingrediente más de una vez',
);

export const orderItemSchema = z.object({
  productId: uuid,
  quantity: z.number().int().min(1).max(99),
  optionIds: selectionIds,
  removedIds: selectionIds,
  isShared: z.boolean(),
}).strict();

/** Prices and participant identity are always resolved again in Postgres. */
export const submitOrderSchema = z.object({
  sessionId: uuid,
  requestId: uuid,
  items: z.array(orderItemSchema).min(1).max(50),
  expectedTotal: z.number().finite().min(0).max(99999999.99).refine(
    amount => Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001,
    'El importe debe tener como máximo dos decimales',
  ),
  notes: z.string().trim().max(500).optional(),
}).strict();

export type SubmitOrderInput = z.infer<typeof submitOrderSchema>;
export type OrderStatus = Database['public']['Enums']['order_status'];
export const orderStatusLabels: Record<OrderStatus, string> = {
  submitted: 'Enviado',
  accepted: 'Recibido · en cuenta',
  in_preparation: 'En preparación',
  ready: 'Listo para servir',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export type SubmitOrderResult = { orderId: string; status: OrderStatus; totalAmount: number };

import { z } from 'zod';
import { Constants, type Database } from './database.types.ts';
import { hasAtMostTwoDecimals } from './money.ts';
import { uuidSchema } from './schemas.ts';

const uuid = uuidSchema.transform(value => value.toLowerCase());
const selectionIds = z.array(uuid).max(100).refine(
  ids => new Set(ids).size === ids.length,
  'No se puede elegir la misma opción o ingrediente más de una vez',
);

/** Unidades por línea: el mismo rango que ofrece el control de cantidad del comensal. */
export const MIN_ITEM_QUANTITY = 1;
export const MAX_ITEM_QUANTITY = 99;

/** Líneas distintas por pedido: el tope que valida el servidor y que el carrito avisa antes de enviar. */
export const MAX_ORDER_LINES = 50;

export const orderItemSchema = z.object({
  productId: uuid,
  quantity: z.number().int().min(MIN_ITEM_QUANTITY).max(MAX_ITEM_QUANTITY),
  optionIds: selectionIds,
  removedIds: selectionIds,
  isShared: z.boolean(),
}).strict();

/** Prices and participant identity are always resolved again in Postgres. */
export const submitOrderSchema = z.object({
  sessionId: uuid,
  requestId: uuid,
  items: z.array(orderItemSchema).min(1).max(MAX_ORDER_LINES),
  expectedTotal: z.number().finite().min(0).max(99999999.99)
    .refine(hasAtMostTwoDecimals, 'El importe debe tener como máximo dos decimales'),
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

/** Respuesta exitosa de submit-order: la función la arma y el comensal la valida. */
export const submitOrderResultSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(Constants.public.Enums.order_status),
  totalAmount: z.number().finite(),
});
export type SubmitOrderResult = z.infer<typeof submitOrderResultSchema>;


/**
 * Estados que forman parte de la cuenta. Es el espejo exacto del
 * `filter (where status in (…))` de la vista `session_bills`: si cambia uno,
 * tienen que cambiar los dos. Lo verifican supabase/tests/split.sql contra la
 * base y packages/shared/tests/split.test.ts contra supabase/schema.generated.sql.
 */
export const billedOrderStatuses = [
  'accepted',
  'in_preparation',
  'ready',
  'delivered',
] as const satisfies readonly OrderStatus[];

export function isBilledStatus(status: OrderStatus): boolean {
  return (billedOrderStatuses as readonly OrderStatus[]).includes(status);
}

/** `table`: la cuenta de una mesa. `takeout`: una compra para llevar, sin mesa. */
export type SessionKind = Database['public']['Enums']['session_kind'];
/** Canal por el que entró un pedido. No cambia después de crearlo. */
export type OrderOrigin = Database['public']['Enums']['order_origin'];

export const orderOriginLabels: Record<OrderOrigin, string> = {
  qr: 'QR',
  pos: 'POS',
};

/**
 * Contexto de una cuenta (contrato C1 de docs/sprint3-progress.md). La sucursal
 * es de la cuenta, no de la mesa: con ella se resuelven permisos, medios de
 * pago y tablero. `table` es null si y solo si `kind` es `takeout`.
 */
export type SessionContext = {
  sessionId: string;
  restaurantId: string;
  branchId: string;
  kind: SessionKind;
  table: { id: string; label: string } | null;
  status: Database['public']['Enums']['session_status'];
};

/** Lo mínimo para nombrar una cuenta: su tipo y, si tiene, su mesa. */
export type SessionPlace = { kind: SessionKind; tables?: { label: string } | null };

/**
 * Cómo se nombra una cuenta en las pantallas del personal. Una cuenta de mesa
 * sin la mesa a la vista (RLS, o la consulta no la trajo) no inventa un nombre.
 */
export function sessionPlaceLabel(session: SessionPlace): string {
  if (session.kind === 'takeout') return 'Para llevar';
  return session.tables?.label ?? 'Mesa';
}

/** Lo que el pedido guarda de quién lo creó (contrato C2). */
export type OrderAuthorship = {
  origin: OrderOrigin;
  submitted_by: string | null;
  staff_author_name: string | null;
};

/**
 * Nombre de quien creó el pedido: el comensal que lo envió por QR o la cuenta
 * de personal que lo cargó en el POS. Sale de lo que guardó el pedido, nunca del
 * responsable actual de la mesa, que cambia con cada operación. Si el comensal
 * ya no está en la cuenta, el autor es desconocido y se dice así.
 */
export function orderAuthorName(
  order: OrderAuthorship,
  participants: readonly { id: string; display_name: string }[],
): string {
  if (order.origin === 'pos') return order.staff_author_name ?? 'Personal';
  return participants.find((participant) => participant.id === order.submitted_by)?.display_name
    ?? 'Comensal';
}

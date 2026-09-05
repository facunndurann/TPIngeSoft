const businessErrors: Record<string, [number, string]> = {
  AUTH_REQUIRED: [401, 'Necesitás volver a conectar con tu mesa para enviar el pedido.'],
  INVALID_REQUEST: [400, 'El pedido no tiene un formato válido. Revisá el carrito.'],
  INVALID_ITEMS: [400, 'Revisá los productos y cantidades del carrito.'],
  SESSION_NOT_FOUND: [404, 'No encontramos esta sesión de mesa.'],
  SESSION_CLOSED: [409, 'Esta sesión de mesa ya está cerrada.'],
  NOT_PARTICIPANT: [403, 'Ingresá desde el QR de esta mesa para realizar pedidos.'],
  TABLE_UNAVAILABLE: [409, 'La mesa o sucursal no está disponible para recibir pedidos.'],
  PRODUCT_UNAVAILABLE: [409, 'Un producto ya no está disponible. Actualizamos la carta para que revises tu carrito.'],
  INVALID_MODIFIERS: [409, 'Cambiaron las opciones disponibles de un plato. Revisá su personalización.'],
  INVALID_INGREDIENTS: [409, 'Revisá los ingredientes: hay cambios en su disponibilidad o en cuáles se pueden quitar.'],
  PRICE_CHANGED: [409, 'El precio cambió. Revisá el total actualizado y volvé a confirmar.'],
  IDEMPOTENCY_CONFLICT: [409, 'Este envío ya se usó para otro contenido. Revisá los pedidos de la mesa antes de continuar.'],
  ORDER_NOT_FOUND: [404, 'No encontramos el pedido.'],
  FORBIDDEN: [403, 'No tenés permiso para realizar esta operación.'],
  POS_UNAVAILABLE: [503, 'El restaurante no puede recibir el pedido ahora. Reintentá este mismo envío en unos momentos.'],
  POS_UNSUPPORTED: [503, 'La integración del restaurante todavía no está disponible. Reintentá este mismo envío cuando el restaurante la habilite.'],
  INVALID_TRANSITION: [409, 'El pedido ya no permite ese cambio de estado.'],
};

export class OrderError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

export function databaseError(error: { message: string }): OrderError {
  const known = businessErrors[error.message];
  return known
    ? new OrderError(error.message, known[0], known[1])
    : new OrderError('SERVER_ERROR', 503, 'No pudimos confirmar el resultado. Reintentá el mismo envío para evitar duplicados.');
}

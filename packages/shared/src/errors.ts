/**
 * Catálogo único de errores de negocio. Las RPCs de Postgres levantan el código
 * (`raise exception 'PRICE_CHANGED'`), la función submit-order responde con su
 * `status` HTTP y las apps muestran `message`. `retryable` indica si repetir la
 * misma solicitud puede funcionar: el comensal conserva el envío pendiente solo
 * en ese caso.
 */
type AppErrorDefinition = { status: number; retryable: boolean; message: string }

export const appErrors = {
  // Sesión y permisos
  AUTH_REQUIRED: { status: 401, retryable: true, message: 'Tu sesión expiró. Recargá la página para volver a conectarte.' },
  FORBIDDEN: { status: 403, retryable: false, message: 'No tenés permiso para realizar esta acción.' },

  // Forma de la solicitud
  METHOD_NOT_ALLOWED: { status: 405, retryable: false, message: 'Usá POST para enviar un pedido.' },
  INVALID_REQUEST: { status: 400, retryable: false, message: 'Los datos enviados no son válidos. Revisalos e intentá de nuevo.' },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false, message: 'El pedido es demasiado grande.' },

  // Envío de pedidos (submit_order, abandon_order_request)
  INVALID_ITEMS: { status: 400, retryable: false, message: 'Revisá los productos y cantidades del carrito.' },
  SESSION_NOT_FOUND: { status: 404, retryable: false, message: 'No encontramos esa sesión de mesa.' },
  SESSION_CLOSED: { status: 409, retryable: false, message: 'Esta sesión de mesa ya está cerrada.' },
  NOT_PARTICIPANT: { status: 403, retryable: false, message: 'Ingresá desde el QR de esta mesa para realizar pedidos.' },
  TABLE_UNAVAILABLE: { status: 409, retryable: false, message: 'La mesa o sucursal no está disponible para recibir pedidos.' },
  PRODUCT_UNAVAILABLE: { status: 409, retryable: false, message: 'Un producto ya no está disponible. Actualizamos la carta para que revises tu carrito.' },
  INVALID_MODIFIERS: { status: 409, retryable: false, message: 'Cambiaron las opciones disponibles de un plato. Revisá su personalización.' },
  INVALID_INGREDIENTS: { status: 409, retryable: false, message: 'Revisá los ingredientes: hay cambios en su disponibilidad o en cuáles se pueden quitar.' },
  PRICE_CHANGED: { status: 409, retryable: false, message: 'El precio cambió. Revisá el total actualizado y volvé a confirmar.' },
  IDEMPOTENCY_CONFLICT: { status: 409, retryable: false, message: 'Este envío ya se usó para otro contenido. Revisá los pedidos de la mesa antes de continuar.' },
  REQUEST_ABANDONED: { status: 409, retryable: false, message: 'Cancelaste este envío. Revisá tu carrito y volvé a confirmar.' },

  // POS (transition_order, close_table_session, recepción de pedidos)
  ORDER_NOT_FOUND: { status: 404, retryable: false, message: 'No encontramos ese pedido.' },
  INVALID_TRANSITION: { status: 409, retryable: false, message: 'Ese cambio de estado ya no está permitido. Actualizá el tablero e intentá de nuevo.' },
  POS_UNAVAILABLE: { status: 503, retryable: true, message: 'El POS del restaurante no está recibiendo pedidos ahora. Reintentá en unos momentos.' },
  POS_UNSUPPORTED: { status: 503, retryable: true, message: 'La integración con el POS del restaurante todavía no está disponible. Reintentá más tarde.' },

  // Guardados del panel admin
  SLUG_TAKEN: { status: 409, retryable: false, message: 'Ya existe un restaurante con ese nombre. Probá con otro.' },
  STALE_DATA: { status: 409, retryable: false, message: 'Estos datos cambiaron mientras editabas. Recargá la página y volvé a intentar.' },

  // Falla inesperada: el detalle interno nunca se expone
  SERVER_ERROR: { status: 503, retryable: true, message: 'No pudimos confirmar el resultado. Reintentá el mismo envío para evitar duplicados.' },
} satisfies Record<string, AppErrorDefinition>

export type AppErrorCode = keyof typeof appErrors

export function isAppErrorCode(code: string): code is AppErrorCode {
  return Object.prototype.hasOwnProperty.call(appErrors, code)
}

/** Mensaje del catálogo para un código conocido; si no, `fallback`. */
export function appErrorMessage(code: string, fallback: string): string {
  return isAppErrorCode(code) ? appErrors[code].message : fallback
}

/** Ante un código desconocido (red caída, respuesta inesperada) se asume reintentable. */
export function isRetryableError(code: string): boolean {
  return isAppErrorCode(code) ? appErrors[code].retryable : true
}

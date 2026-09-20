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
  SESSION_NOT_FOUND: { status: 404, retryable: false, message: 'No encontramos la cuenta de esa mesa.' },
  SESSION_CLOSED: { status: 409, retryable: false, message: 'La mesa ya cerró su cuenta.' },
  NOT_PARTICIPANT: { status: 403, retryable: false, message: 'Ingresá desde el QR de esta mesa para realizar pedidos.' },
  INVALID_NAME: { status: 400, retryable: false, message: 'Usá un nombre de 1 a 40 caracteres.' },
  TABLE_UNAVAILABLE: { status: 409, retryable: false, message: 'Esta mesa no está recibiendo pedidos. Consultá con el personal del restaurante.' },
  PRODUCT_UNAVAILABLE: { status: 409, retryable: false, message: 'Un producto ya no está disponible. Actualizamos la carta para que revises tu carrito.' },
  INVALID_MODIFIERS: { status: 409, retryable: false, message: 'Cambiaron las opciones disponibles de un plato. Revisá su personalización.' },
  INVALID_INGREDIENTS: { status: 409, retryable: false, message: 'Revisá los ingredientes: hay cambios en su disponibilidad o en cuáles se pueden quitar.' },
  INVALID_SPLIT: { status: 400, retryable: false, message: 'Revisá la división: los porcentajes tienen que sumar 100 y corresponder a comensales de esta mesa.' },
  PRICE_CHANGED: { status: 409, retryable: false, message: 'El precio cambió. Revisá el total actualizado y volvé a confirmar.' },
  IDEMPOTENCY_CONFLICT: { status: 409, retryable: false, message: 'Este envío ya se usó para otro contenido. Revisá los pedidos de la mesa antes de continuar.' },
  REQUEST_ABANDONED: { status: 409, retryable: false, message: 'Cancelaste este envío. Revisá tu carrito y volvé a confirmar.' },

  // Red: la respuesta nunca llegó, así que el envío se conserva para reintentar.
  CONNECTION_ERROR: { status: 503, retryable: true, message: 'No pudimos confirmar el envío. Reintentá: conservamos tu pedido para evitar duplicados.' },

  // POS (transition_order, close_table_session, recepción de pedidos)
  ORDER_NOT_FOUND: { status: 404, retryable: false, message: 'No encontramos ese pedido.' },
  INVALID_TRANSITION: { status: 409, retryable: false, message: 'Ese cambio de estado ya no está permitido. Actualizá el tablero e intentá de nuevo.' },
  POS_UNAVAILABLE: { status: 503, retryable: true, message: 'El POS del restaurante no está recibiendo pedidos ahora. Reintentá en unos momentos.' },
  POS_UNSUPPORTED: { status: 503, retryable: true, message: 'La integración con el POS del restaurante todavía no está disponible. Reintentá más tarde.' },

  // Salón y mesas (pos_open_table_session, pos_move_table_session)
  TABLE_NOT_FOUND: { status: 404, retryable: false, message: 'Esa mesa ya no existe. Actualizá el plano.' },
  TABLE_OCCUPIED: { status: 409, retryable: false, message: 'La mesa destino ya tiene una comanda abierta. Elegí otra mesa.' },
  TABLE_BRANCH_MISMATCH: { status: 409, retryable: false, message: 'La mesa destino debe estar en la misma sucursal.' },
  SESSION_MOVE_CONFLICT: { status: 409, retryable: false, message: 'La comanda fue movida o cerrada por otro operador. Actualizá el plano.' },
  EMPLOYEE_NOT_FOUND: { status: 403, retryable: false, message: 'Tu cuenta ya no está habilitada en esta sucursal. Volvé a ingresar.' },

  // Guardados del panel admin
  SLUG_TAKEN: { status: 409, retryable: false, message: 'Ya existe un restaurante con ese nombre. Probá con otro.' },
  STALE_DATA: { status: 409, retryable: false, message: 'Estos datos cambiaron mientras editabas. Recargá la página y volvé a intentar.' },
  SECTION_NAME_TAKEN: { status: 409, retryable: false, message: 'Ya existe un sector con ese nombre en esta sucursal.' },
  TABLE_LABEL_TAKEN: { status: 409, retryable: false, message: 'Ya existe una mesa con ese identificador en esta sucursal.' },
  TABLE_SECTION_BRANCH_MISMATCH: { status: 409, retryable: false, message: 'El sector pertenece a otra sucursal.' },
  CATEGORY_IN_USE: { status: 409, retryable: false, message: 'No se puede eliminar: la categoría tiene productos. Movelos o eliminalos primero.' },
  BRANCH_IN_USE: { status: 409, retryable: false, message: 'No se puede eliminar: la sucursal tiene mesas asociadas.' },

  // Falla inesperada: el detalle interno nunca se expone. El mensaje sirve a
  // cualquier operación de las tres apps, lecturas incluidas; quien necesite
  // decir algo más preciso lo pasa al constructor de AppError.
  SERVER_ERROR: { status: 503, retryable: true, message: 'No pudimos completar la operación. Revisá tu conexión y reintentá.' },
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

/**
 * Constraints del schema cuyo nombre ya identifica un error de negocio. Estaban
 * como ternario anidado dentro del admin; acá son datos del mismo catálogo.
 */
const constraintCodes: Record<string, AppErrorCode> = {
  floor_sections_branch_id_name_key: 'SECTION_NAME_TAKEN',
  tables_label_unique_per_branch: 'TABLE_LABEL_TAKEN',
  tables_section_same_branch: 'TABLE_SECTION_BRANCH_MISMATCH',
  products_category_id_fkey: 'CATEGORY_IN_USE',
  tables_branch_id_fkey: 'BRANCH_IN_USE',
}

/** Error de negocio con todo lo que el catálogo sabe de él. */
export class AppError extends Error {
  readonly code: AppErrorCode
  readonly status: number
  readonly retryable: boolean
  /** Texto original de la base; nunca se muestra, sirve para diagnosticar. */
  readonly detail?: string

  constructor(code: AppErrorCode, message: string = appErrors[code].message, detail?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = appErrors[code].status
    this.retryable = appErrors[code].retryable
    this.detail = detail
  }
}

/**
 * Traductor único de errores crudos de Postgres. Cubre las tres formas en que
 * llega un error: el código pelado (`raise exception 'PRICE_CHANGED'`), el
 * código prefijado por Postgres (`P0001: PRICE_CHANGED`) y la violación de un
 * constraint, que trae el nombre del índice. Lo desconocido es SERVER_ERROR con
 * el mensaje del catálogo: el detalle interno no se expone.
 */
export function fromPostgres(raw: string | { message: string }): AppError {
  const message = typeof raw === 'string' ? raw : raw.message
  if (isAppErrorCode(message)) return new AppError(message)

  // El código como palabra suelta, para que el orden del catálogo no importe y
  // un código no pueda matchear dentro de otro más largo.
  for (const token of message.split(/[^A-Z_]+/)) {
    if (isAppErrorCode(token)) return new AppError(token)
  }

  for (const [constraint, code] of Object.entries(constraintCodes)) {
    if (message.includes(constraint)) return new AppError(code, undefined, message)
  }

  return new AppError('SERVER_ERROR', undefined, message)
}

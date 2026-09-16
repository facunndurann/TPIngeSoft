/** Mensajes de los códigos que levantan las RPCs de guardado del panel. */
const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Tu sesión expiró. Volvé a ingresar.',
  FORBIDDEN: 'No tenés permiso para realizar esta acción.',
  INVALID_REQUEST: 'Revisá los datos del formulario.',
  SLUG_TAKEN: 'Ya existe un restaurante con ese nombre. Probá con otro.',
  STALE_DATA: 'Estos datos cambiaron mientras editabas. Recargá la página y volvé a intentar.',
}

/** Error listo para mostrar. Los errores sin código propio conservan el mensaje de la base. */
export function rpcError(error: { message: string }): Error {
  return new Error(messages[error.message] ?? error.message)
}

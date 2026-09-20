import { AppError, fromPostgres } from '@restaurant-platform/shared'

/**
 * Error de una lectura del comensal. Conserva el código cuando la base levantó
 * uno del catálogo; si no, dice qué lectura falló, porque el mensaje genérico del
 * catálogo está escrito para el envío de un pedido ("reintentá el mismo envío") y
 * en una consulta no tiene sentido. El texto crudo queda como detalle, no a la vista.
 */
export function fromRead(error: { message: string }, what: string): AppError {
  const mapped = fromPostgres(error)
  if (mapped.code !== 'SERVER_ERROR') return mapped

  return new AppError(
    'SERVER_ERROR',
    `No pudimos cargar ${what}. Revisá tu conexión y reintentá.`,
    error.message,
  )
}

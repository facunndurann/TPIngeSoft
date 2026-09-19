import { appErrorMessage } from '@restaurant-platform/shared'

/** Error listo para mostrar. Los errores sin código del catálogo conservan el mensaje de la base. */
export function rpcError(error: { message: string }): Error {
  return new Error(appErrorMessage(error.message, error.message))
}

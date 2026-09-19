import { appErrors, isAppErrorCode, type AppErrorCode } from '../../../packages/shared/src/errors.ts';

/** Error de negocio con el status HTTP y el mensaje del catálogo compartido. */
export class OrderError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;

  constructor(code: AppErrorCode) {
    super(appErrors[code].message);
    this.code = code;
    this.status = appErrors[code].status;
  }
}

/** Traduce un error de Postgres: solo los códigos del catálogo llegan al cliente. */
export function databaseError(error: { message: string }): OrderError {
  return new OrderError(isAppErrorCode(error.message) ? error.message : 'SERVER_ERROR');
}

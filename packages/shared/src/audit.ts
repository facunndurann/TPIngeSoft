import { z } from 'zod'
import { Constants } from './database.types.ts'

/** Un texto guardado en `details`, o nada si falta o llegó con otro tipo. */
const text = z.string().optional().catch(undefined)

/** Un código de un enum de la base, o nada si falta o ya no es uno conocido. */
const code = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).optional().catch(undefined)

/**
 * Lo que las acciones del POS guardan en `pos_audit_log.details` (las escriben
 * `record_pos_action`, `save_employee_account` y `audit_employee_password_reset`).
 * Es JSON libre y con historia, así que se lee campo por campo sin confiar en
 * nada: lo que falta o llega con otro tipo (un importe como texto, un estado que
 * ya no existe, `toString`) queda en `undefined` sin tirar abajo el resto, y un
 * `details` que ni siquiera es un objeto se lee vacío.
 */
export const auditDetailsSchema = z
  .object({
    actorName: text,
    employeeName: text,
    fullName: text,
    accountId: text,
    tableLabel: text,
    sourceTableLabel: text,
    destinationTableLabel: text,
    from: code(Constants.public.Enums.order_status),
    to: code(Constants.public.Enums.order_status),
    kind: code(Constants.public.Enums.session_request_kind),
    method: code(Constants.public.Enums.payment_method),
    amount: z.number().finite().optional().catch(undefined),
  })
  .catch({})

export type AuditDetails = z.infer<typeof auditDetailsSchema>

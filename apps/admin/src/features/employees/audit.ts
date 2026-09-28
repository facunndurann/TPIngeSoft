import {
  auditDetailsSchema,
  type AuditDetails,
  formatPrice,
  isUuid,
  orderStatusLabels,
  paymentMethodLabels,
  sessionRequestLabels,
} from '@restaurant-platform/shared'

type Person = { user_id: string; full_name: string }

/** Nombre del actor en auditoría. Owner/manager sin profile no están en la lista de empleados. */
export function auditActorLabel(
  entry: {
    actor_user_id: string | null
    employee_id: string | null
    user_id: string | null
    details: unknown
    legacy_employee?: { full_name: string } | null
  },
  employees: Person[],
): string {
  const details = auditDetailsSchema.parse(entry.details)
  const named =
    employees.find((person) => person.user_id === entry.actor_user_id)?.full_name
    ?? details.actorName
    ?? details.employeeName
    ?? entry.legacy_employee?.full_name
  // Un id que quedó donde iba un nombre no se muestra: mejor el rol que un pedazo de UUID.
  if (named && !isUuid(named)) return named
  if (entry.actor_user_id) return 'Administrador'
  if (entry.employee_id) return 'Empleado histórico'
  return 'Registro histórico'
}

/** Lo que cada acción sabe de sí misma: sus `details` y, si es sobre una cuenta, de quién. */
type AuditContext = { details: AuditDetails; account: string | null }

/**
 * Cómo se lee cada acción que se escribe en `pos_audit_log`. Son las que usan las
 * migraciones: las del POS pasan por `record_pos_action`, las de cuentas por
 * `save_employee_account` y `audit_employee_password_reset`, y las `employee.*`
 * son del POS anterior con PIN. Cada frase usa lo que esa acción guarda en
 * `details`, y si falta un dato dice lo mismo sin él.
 *
 * Es un Map y no un objeto: una acción llamada `toString` no puede encontrar lo
 * heredado de Object.
 */
const auditDescriptions = new Map(Object.entries({
  'account.created': ({ account }) => (account ? `Creó la cuenta de ${account}` : 'Creó una cuenta'),
  'account.updated': ({ account }) =>
    account ? `Editó el acceso de ${account}` : 'Editó el acceso de una cuenta',
  // Se registra antes de cambiarla: si el cambio falla, queda solo este.
  'account.password_reset_requested': ({ account }) =>
    account
      ? `Pidió restablecer la contraseña de ${account}`
      : 'Pidió restablecer la contraseña de una cuenta',
  'account.password_reset': ({ account }) =>
    account ? `Restableció la contraseña de ${account}` : 'Restableció la contraseña de una cuenta',

  'employee.created': ({ account }) =>
    account ? `Dio de alta a ${account} con PIN` : 'Dio de alta un empleado con PIN',
  'employee.updated': ({ account }) =>
    account ? `Editó a ${account}, empleado con PIN` : 'Editó un empleado con PIN',
  'employee.deleted': ({ details: { employeeName } }) =>
    employeeName ? `Eliminó a ${employeeName}, empleado con PIN` : 'Eliminó un empleado con PIN',
  'pos.unlocked': () => 'Desbloqueó el POS con su PIN',

  'order.transition': ({ details: { from, to } }) =>
    from && to
      ? `Pasó un pedido de «${orderStatusLabels[from]}» a «${orderStatusLabels[to]}»`
      : 'Cambió el estado de un pedido',
  'session.opened': ({ details: { tableLabel } }) => (tableLabel ? `Abrió ${tableLabel}` : 'Abrió una mesa'),
  'session.resumed': ({ details: { tableLabel } }) =>
    tableLabel ? `Retomó la comanda de ${tableLabel}` : 'Retomó la comanda de una mesa',
  'session.closed': () => 'Cerró una mesa',
  'session.moved': ({ details: { sourceTableLabel, destinationTableLabel } }) =>
    sourceTableLabel && destinationTableLabel
      ? `Movió la comanda de ${sourceTableLabel} a ${destinationTableLabel}`
      : 'Movió una comanda de mesa',
  'session.request_attended': ({ details: { kind } }) =>
    kind ? `Atendió «${sessionRequestLabels[kind]}»` : 'Atendió un pedido de una mesa',
  'payment.recorded': ({ details: { amount, method } }) => {
    if (amount === undefined) return 'Registró un pago'
    return `Registró un pago de ${formatPrice(amount)}${method ? ` (${paymentMethodLabels[method]})` : ''}`
  },
} satisfies Record<string, (context: AuditContext) => string>))

/**
 * Qué hizo la entrada, dicho para una persona: «Creó la cuenta de Ana Pérez», no
 * `account.created`. La cuenta sale de `fullName` o, si solo se guardó su id
 * (restablecer contraseña), de la lista de empleados. Una acción que todavía no
 * está en el mapa se muestra con su código: mejor eso que perder el registro.
 */
export function auditActionLabel(entry: { action: string; details: unknown }, employees: Person[]): string {
  const describe = auditDescriptions.get(entry.action)
  if (!describe) return entry.action
  const details = auditDetailsSchema.parse(entry.details)
  const account =
    details.fullName
    ?? employees.find((person) => person.user_id === details.accountId)?.full_name
    ?? null
  return describe({ details, account })
}

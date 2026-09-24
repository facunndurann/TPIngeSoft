import {
  formatPrice,
  orderStatusLabels,
  paymentMethodLabels,
  sessionRequestLabels,
} from '@restaurant-platform/shared'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Person = { user_id: string; full_name: string }

/** `details` es JSON libre: de un objeto solo se leen strings, y el resto es `null`. */
function detailText(details: unknown, key: string): string | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const value = (details as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

/** Un importe de `details`: la base guarda `numeric`, que llega como número. */
function detailAmount(details: unknown, key: string): number | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const value = (details as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Si el objeto tiene esa clave propia. No es `in`, que también encuentra lo
 * heredado: `'toString' in labels` es `true`.
 */
function hasKey(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

/** El nombre de un código guardado en `details`, o `null` si el código no se conoce. */
function labelOf<K extends string>(labels: Record<K, string>, code: string | null): string | null {
  return code !== null && hasKey(labels, code) ? labels[code as K] : null
}

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
  const named =
    employees.find((person) => person.user_id === entry.actor_user_id)?.full_name
    ?? detailText(entry.details, 'actorName')
    ?? detailText(entry.details, 'employeeName')
    ?? entry.legacy_employee?.full_name
    ?? null
  if (named && !UUID_RE.test(named)) return named
  if (entry.actor_user_id) return 'Administrador'
  if (entry.employee_id) return 'Empleado histórico'
  return 'Registro histórico'
}

/** Lo que cada acción sabe de sí misma: sus `details` y, si es sobre una cuenta, de quién. */
type AuditContext = { details: unknown; account: string | null }

/**
 * Cómo se lee cada acción que se escribe en `pos_audit_log`. Son las que usan las
 * migraciones: las del POS pasan por `record_pos_action`, las de cuentas por
 * `save_employee_account` y `audit_employee_password_reset`, y las `employee.*`
 * son del POS anterior con PIN. Cada frase usa lo que esa acción guarda en
 * `details`, y si falta un dato dice lo mismo sin él.
 */
const auditDescriptions = {
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
  'employee.deleted': ({ details }) => {
    const name = detailText(details, 'employeeName')
    return name ? `Eliminó a ${name}, empleado con PIN` : 'Eliminó un empleado con PIN'
  },
  'pos.unlocked': () => 'Desbloqueó el POS con su PIN',

  'order.transition': ({ details }) => {
    const from = labelOf(orderStatusLabels, detailText(details, 'from'))
    const to = labelOf(orderStatusLabels, detailText(details, 'to'))
    return from && to ? `Pasó un pedido de «${from}» a «${to}»` : 'Cambió el estado de un pedido'
  },
  'session.opened': ({ details }) => {
    const table = detailText(details, 'tableLabel')
    return table ? `Abrió ${table}` : 'Abrió una mesa'
  },
  'session.resumed': ({ details }) => {
    const table = detailText(details, 'tableLabel')
    return table ? `Retomó la comanda de ${table}` : 'Retomó la comanda de una mesa'
  },
  'session.closed': () => 'Cerró una mesa',
  'session.moved': ({ details }) => {
    const from = detailText(details, 'sourceTableLabel')
    const to = detailText(details, 'destinationTableLabel')
    return from && to ? `Movió la comanda de ${from} a ${to}` : 'Movió una comanda de mesa'
  },
  'session.request_attended': ({ details }) => {
    const kind = labelOf(sessionRequestLabels, detailText(details, 'kind'))
    return kind ? `Atendió «${kind}»` : 'Atendió un pedido de una mesa'
  },
  'payment.recorded': ({ details }) => {
    const amount = detailAmount(details, 'amount')
    const method = labelOf(paymentMethodLabels, detailText(details, 'method'))
    if (amount === null) return 'Registró un pago'
    return `Registró un pago de ${formatPrice(amount)}${method ? ` (${method})` : ''}`
  },
} satisfies Record<string, (context: AuditContext) => string>

/**
 * Qué hizo la entrada, dicho para una persona: «Creó la cuenta de Ana Pérez», no
 * `account.created`. La cuenta sale de `fullName` o, si solo se guardó su id
 * (restablecer contraseña), de la lista de empleados. Una acción que todavía no
 * está en el mapa se muestra con su código: mejor eso que perder el registro.
 */
export function auditActionLabel(entry: { action: string; details: unknown }, employees: Person[]): string {
  if (!hasKey(auditDescriptions, entry.action)) return entry.action
  const accountId = detailText(entry.details, 'accountId')
  const account =
    detailText(entry.details, 'fullName')
    ?? employees.find((person) => person.user_id === accountId)?.full_name
    ?? null
  const describe = auditDescriptions[entry.action as keyof typeof auditDescriptions]
  return describe({ details: entry.details, account })
}

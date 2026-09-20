import type { OrderStatus } from './orders.ts'

export const employeeRoles = ['manager', 'supervisor', 'waiter', 'cashier', 'kitchen'] as const
export type EmployeeRole = typeof employeeRoles[number]
export const employeeRoleLabels: Record<EmployeeRole, string> = {
  manager: 'Gestor', supervisor: 'Supervisor', waiter: 'Mozo', cashier: 'Caja', kitchen: 'Cocina',
}

export function normalizeUsername(value: string): string {
  const username = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/.test(username)) {
    throw new Error('El usuario debe tener 3–32 caracteres: letras, números, puntos, guiones o guiones bajos; empezar y terminar con letra o número.')
  }
  return username
}

export function employeeEmail(username: string, domain: string): string {
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain)) {
    throw new Error('Falta configurar el dominio de cuentas de empleados.')
  }
  return `${normalizeUsername(username)}@${domain.toLowerCase()}`
}

/**
 * Catálogo de permisos. La fuente de verdad son las filas de `role_permissions`
 * (sembradas en 20260919010000_employee_accounts y 20260919060000_pos_session_operations);
 * supabase/tests/orders.integration.mjs falla si esta lista no coincide con ellas.
 *
 * Existe para que un typo como 'session.open' no compile: antes hacía
 * desaparecer un botón en silencio, sin romper ningún test.
 */
export const posPermissions = [
  'admin.manage',
  'audit.read',
  'employees.manage',
  'floor.read',
  'history.read',
  'orders.accept',
  'orders.cancel',
  'orders.deliver',
  'orders.prepare',
  'orders.read',
  'orders.revert',
  'payments.read',
  'sessions.close',
  'sessions.move',
  'sessions.open',
] as const

export type PosPermission = (typeof posPermissions)[number]

export function isPosPermission(value: string): value is PosPermission {
  return (posPermissions as readonly string[]).includes(value)
}

/** Permiso que habilita una transición concreta del tablero. */
export function transitionPermission(from: OrderStatus, to: OrderStatus): PosPermission {
  if (to === 'cancelled') return 'orders.cancel'
  const sequence: OrderStatus[] = ['submitted', 'accepted', 'in_preparation', 'ready', 'delivered']
  if (sequence.indexOf(to) < sequence.indexOf(from)) return 'orders.revert'
  if (to === 'accepted') return 'orders.accept'
  if (to === 'delivered') return 'orders.deliver'
  return 'orders.prepare'
}

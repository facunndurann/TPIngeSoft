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

export function transitionPermission(from: OrderStatus, to: OrderStatus): string {
  if (to === 'cancelled') return 'orders.cancel'
  const sequence: OrderStatus[] = ['submitted', 'accepted', 'in_preparation', 'ready', 'delivered']
  if (sequence.indexOf(to) < sequence.indexOf(from)) return 'orders.revert'
  if (to === 'accepted') return 'orders.accept'
  if (to === 'delivered') return 'orders.deliver'
  return 'orders.prepare'
}

import { z } from 'zod'
import type { Enums } from './database.types.ts'
import { uuidSchema as uuid } from './schemas.ts'

export const employeeRoles = ['manager', 'supervisor', 'waiter', 'cashier', 'kitchen'] as const
export type EmployeeRole = typeof employeeRoles[number]
export const employeeRoleLabels: Record<EmployeeRole, string> = {
  manager: 'Gestor', supervisor: 'Supervisor', waiter: 'Mozo', cashier: 'Caja', kitchen: 'Cocina',
}

/**
 * Nombre de cualquier rol de una membresía. Owner y staff pueden figurar en la
 * lista de cuentas, aunque desde el panel solo se asignan los de `employeeRoles`.
 */
export const memberRoleLabels: Record<Enums<'member_role'>, string> = {
  ...employeeRoleLabels, owner: 'Dueño', staff: 'Personal',
}

export function isEmployeeRole(value: string): value is EmployeeRole {
  return (employeeRoles as readonly string[]).includes(value)
}

/**
 * Marca o desmarca un rol. Gestor es exclusivo: marcarlo deja solo ese, y marcar
 * cualquier otro lo saca. `employeeRequestSchema` rechaza la combinación.
 */
export function toggleRole(roles: readonly EmployeeRole[], role: EmployeeRole, checked: boolean): EmployeeRole[] {
  if (!checked) return roles.filter((current) => current !== role)
  if (role === 'manager') return ['manager']
  return [...roles.filter((current) => current !== 'manager' && current !== role), role]
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/

export function normalizeUsername(value: string): string {
  const username = value.trim().toLowerCase()
  if (!USERNAME.test(username)) {
    throw new Error('El usuario debe tener 3–32 caracteres: letras, números, puntos, guiones o guiones bajos; empezar y terminar con letra o número.')
  }
  return username
}

const password = z.string().min(10).max(128)

/** Lo que se decide de una cuenta en un restaurante: nombre, roles, sucursales y acceso. */
const access = {
  restaurantId: uuid,
  fullName: z.string().trim().min(1).max(100),
  roles: z.array(z.enum(employeeRoles)).min(1)
    .refine((roles) => !roles.includes('manager') || roles.length === 1, 'Gestor no se combina con otros roles'),
  branchIds: z.array(uuid).min(1),
  active: z.boolean(),
  /** Registro de empleado del POS anterior (con PIN) que pasa a esta cuenta. */
  legacyId: uuid.optional(),
}

/**
 * Contrato de la Edge Function `employee-accounts`: el panel arma el pedido con
 * este tipo y la función lo valida con este schema. Cada acción declara solo lo
 * suyo (`strict`): nadie puede mandar un `userId` al crear ni cambiar roles al
 * restablecer una contraseña.
 */
export const employeeRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    // Mismo formato que `normalizeUsername`: se guarda ya normalizado.
    username: z.string().trim().toLowerCase().regex(USERNAME),
    password,
    ...access,
  }).strict(),
  z.object({ action: z.literal('update'), userId: uuid, ...access }).strict(),
  z.object({ action: z.literal('reset-password'), restaurantId: uuid, userId: uuid, password }).strict(),
])
export type EmployeeRequest = z.infer<typeof employeeRequestSchema>

export const employeeResultSchema = z.object({ userId: uuid })

/**
 * Si `domain` sirve para armar las cuentas de empleados. Se exporta para que el
 * POS lo revise al arrancar, con la misma regla que aplica `employeeEmail`.
 */
export function isEmployeeEmailDomain(domain: string): boolean {
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain)
}

export function employeeEmail(username: string, domain: string): string {
  if (!isEmployeeEmailDomain(domain)) {
    throw new Error('Falta configurar el dominio de cuentas de empleados.')
  }
  return `${normalizeUsername(username)}@${domain.toLowerCase()}`
}

/**
 * Catálogo de permisos. La fuente de verdad son las filas de `role_permissions`
 * (sembradas en 20260919010000_employee_accounts, 20260919060000_pos_session_operations
 * y 20260920000000_session_service_requests);
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
  'payments.write',
  'sessions.attend',
  'sessions.close',
  'sessions.move',
  'sessions.open',
] as const

export type PosPermission = (typeof posPermissions)[number]

export function isPosPermission(value: string): value is PosPermission {
  return (posPermissions as readonly string[]).includes(value)
}

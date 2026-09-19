import type { Database, EmployeeRole } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

export type Employee = Database['public']['Functions']['list_employee_accounts']['Returns'][number]
export type EmployeeChange = {
  action: 'create' | 'update' | 'reset-password'
  restaurantId: string
  userId?: string
  username?: string
  password?: string
  fullName?: string
  roles?: EmployeeRole[]
  branchIds?: string[]
  active?: boolean
  legacyId?: string
}
export async function loadEmployees(restaurantId: string) {
  const { data, error } = await supabase.rpc('list_employee_accounts', { p_restaurant: restaurantId })
  if (error) throw error
  return data
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Nombre del actor en auditoría. Owner/manager sin profile no están en la lista de empleados. */
export function auditActorLabel(
  entry: {
    actor_user_id: string | null
    employee_id: string | null
    user_id: string | null
    details: unknown
    legacy_employee?: { full_name: string } | null
  },
  employees: Array<{ user_id: string; full_name: string }>,
): string {
  const details =
    entry.details && typeof entry.details === 'object' && !Array.isArray(entry.details)
      ? (entry.details as Record<string, unknown>)
      : {}
  const named =
    employees.find((person) => person.user_id === entry.actor_user_id)?.full_name
    ?? (typeof details.actorName === 'string' ? details.actorName : null)
    ?? (typeof details.employeeName === 'string' ? details.employeeName : null)
    ?? entry.legacy_employee?.full_name
    ?? null
  if (named && !UUID_RE.test(named)) return named
  if (entry.actor_user_id) return 'Administrador'
  if (entry.employee_id) return 'Empleado histórico'
  return 'Registro histórico'
}

export async function changeEmployee(body: EmployeeChange) {
  const { data, error } = await supabase.functions.invoke('employee-accounts', { body })
  if (error) {
    const details = error.context instanceof Response ? await error.context.json().catch(() => null) : null
    const messages: Record<string, string> = {
      USERNAME_TAKEN: 'Ese nombre de usuario ya existe. Elegí otro.',
      FORBIDDEN: 'No tenés permiso para modificar esta cuenta o alguna de sus membresías.',
      INVALID_REQUEST: 'Revisá los datos, roles y sucursales. La contraseña debe tener al menos 10 caracteres.',
      PROVISIONING_CLEANUP_REQUIRED: 'El alta quedó pendiente de revisión. Contactá al soporte antes de reintentar.',
    }
    throw new Error(messages[details?.error] ?? 'No pudimos guardar la cuenta. Reintentá.')
  }
  return data
}

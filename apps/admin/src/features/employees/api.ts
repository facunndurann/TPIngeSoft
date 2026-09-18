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

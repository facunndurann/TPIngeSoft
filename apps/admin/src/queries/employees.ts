import { queryOptions } from '@tanstack/react-query'
import {
  AppError,
  employeeResultSchema,
  invokeFunction,
  type Database,
  type EmployeeRequest,
  unwrap,
} from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

export type Employee = Database['public']['Functions']['list_employee_accounts']['Returns'][number]

/**
 * Raíz de las cachés de empleados del restaurante. Un cambio de cuenta toca la
 * lista, la auditoría y lo que queda por vincular, así que se invalida entera.
 */
export const employeesKey = (restaurantId: string) => ['employees', restaurantId] as const

export const employeesQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: [...employeesKey(restaurantId), 'accounts'] as const,
    queryFn: async () =>
      unwrap(await supabase.rpc('list_employee_accounts', { p_restaurant: restaurantId })),
  })

/** Últimas acciones del POS; se relee sola porque el POS escribe mientras se mira. */
export const employeeAuditQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: [...employeesKey(restaurantId), 'audit'] as const,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('pos_audit_log')
          .select('*, legacy_employee:pos_employees(full_name)')
          .eq('restaurant_id', restaurantId)
          .order('created_at', { ascending: false })
          .limit(100),
      ),
    refetchInterval: 30_000,
  })

/** Empleados del POS anterior (con PIN) que todavía no pasaron a una cuenta. */
export const legacyEmployeesQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: [...employeesKey(restaurantId), 'legacy'] as const,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('pos_employees')
          .select('id, full_name')
          .eq('restaurant_id', restaurantId)
          .is('migrated_user_id', null),
      ),
  })

/** Cuentas globales que este administrador puede vincular al restaurante. */
export const linkableAccountsQuery = (restaurantId: string) =>
  queryOptions({
    queryKey: [...employeesKey(restaurantId), 'linkable'] as const,
    queryFn: async () =>
      unwrap(await supabase.from('profiles').select('id, full_name, username_normalized')),
  })

/**
 * Crea, actualiza o restablece una cuenta con la Edge Function `employee-accounts`.
 * Si la respuesta no llega, el cambio pudo haberse aplicado igual: reintentar un
 * alta sin mirar chocaría con su propio usuario.
 */
export function changeEmployee(request: EmployeeRequest) {
  return invokeFunction(supabase, 'employee-accounts', request, employeeResultSchema, {
    unreachable: new AppError(
      'CONNECTION_ERROR',
      'No pudimos confirmar el cambio. Revisá la lista de empleados antes de reintentar.',
    ),
  })
}

import { supabase } from '@/lib/supabase'
import type { PosOperator } from './operator-context'

const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Tu sesión expiró. Volvé a ingresar.',
  INVALID_REQUEST: 'Faltan datos para completar la operación.',
  FORBIDDEN: 'No tenés permisos para esta acción.',
  INVALID_PIN: 'PIN incorrecto.',
  PIN_TAKEN: 'Ese PIN ya lo usa otro empleado activo.',
  NAME_TAKEN: 'Ya hay un empleado con ese nombre.',
  EMPLOYEE_NOT_FOUND: 'El empleado ya no existe o está inactivo.',
}

export class PosEmployeeError extends Error {
  readonly code: string
  constructor(rawMessage: string) {
    const code = Object.keys(messages).find((key) => rawMessage.includes(key))
    super(code ? messages[code] : 'No pudimos completar la operación. Reintentá.')
    this.code = code ?? 'UNKNOWN'
  }
}

export type PosEmployee = {
  id: string
  full_name: string
  is_active: boolean
  created_at: string
}

export async function loadPosEmployees(restaurantId: string) {
  const { data, error } = await supabase
    .from('pos_employees')
    .select('id, full_name, is_active, created_at')
    .eq('restaurant_id', restaurantId)
    .order('full_name')
  if (error) throw new PosEmployeeError(error.message)
  return (data ?? []) as PosEmployee[]
}

export async function verifyPosPin(restaurantId: string, pin: string): Promise<PosOperator> {
  const { data, error } = await supabase.rpc('verify_pos_pin', {
    p_restaurant_id: restaurantId,
    p_pin: pin,
  })
  if (error) throw new PosEmployeeError(error.message)
  const employee = data?.[0]
  if (!employee) throw new PosEmployeeError('INVALID_PIN')
  return { id: employee.id, fullName: employee.full_name }
}

export type SavePosEmployeeInput = {
  restaurantId: string
  fullName: string
  /** Obligatorio al crear; al editar, null deja el PIN actual. */
  pin: string | null
  employeeId?: string
  isActive?: boolean
}

export async function savePosEmployee(input: SavePosEmployeeInput) {
  const { data, error } = await supabase.rpc('upsert_pos_employee', {
    p_restaurant_id: input.restaurantId,
    p_full_name: input.fullName,
    // omitir el PIN conserva el actual; omitir el id crea un empleado nuevo
    p_pin: input.pin ?? undefined,
    p_employee_id: input.employeeId,
    p_is_active: input.isActive ?? true,
  })
  if (error) throw new PosEmployeeError(error.message)
  return data
}

export type PosAuditEntry = {
  id: string
  action: string
  created_at: string
  details: unknown
  employee_id: string | null
  order_id: string | null
  session_id: string | null
}

export async function loadPosAudit(restaurantId: string, limit = 30) {
  const { data, error } = await supabase
    .from('pos_audit_log')
    .select('id, action, created_at, details, employee_id, order_id, session_id')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new PosEmployeeError(error.message)
  return (data ?? []) as PosAuditEntry[]
}

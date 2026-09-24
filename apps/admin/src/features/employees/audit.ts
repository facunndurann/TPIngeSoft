const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `details` es JSON libre: de un objeto solo se leen strings, y el resto es `null`. */
function detailText(details: unknown, key: string): string | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const value = (details as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
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
  employees: Array<{ user_id: string; full_name: string }>,
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

/** La cuenta a la que se refiere la entrada (creada, editada o restablecida), si quedó guardada. */
export function auditSubject(entry: { details: unknown }): string | null {
  return detailText(entry.details, 'fullName')
}

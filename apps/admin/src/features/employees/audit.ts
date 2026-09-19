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

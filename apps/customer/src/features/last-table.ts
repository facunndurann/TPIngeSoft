const STORAGE_KEY = 'customer-last-table'

/** Lo mínimo para volver a una mesa y nombrarla; nada del pedido ni del comensal. */
export type LastTable = { token: string; tableLabel: string; restaurantName: string }

export function rememberTable(table: LastTable) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table))
  } catch {
    /* Sin almacenamiento (ventana privada) simplemente no hay atajo de vuelta. */
  }
}

export function lastTable(): LastTable | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    const value: unknown = JSON.parse(raw)
    return isLastTable(value) ? value : undefined
  } catch {
    return undefined
  }
}

// Lo guardado puede venir de una versión vieja o estar corrupto: sin las tres
// cadenas no hay atajo que ofrecer, y un enlace a medias sería peor que ninguno.
function isLastTable(value: unknown): value is LastTable {
  if (typeof value !== 'object' || value === null) return false
  const { token, tableLabel, restaurantName } = value as Record<string, unknown>
  return [token, tableLabel, restaurantName].every(
    (field) => typeof field === 'string' && field.length > 0,
  )
}

/**
 * Zona del restaurante. Postgres calcula el día de cada pedido con la misma zona
 * (columna generada orders.local_date); acá solo se usa para saber qué día es hoy
 * y para mostrar horas.
 */
export const POS_TIME_ZONE = 'America/Argentina/Buenos_Aires'

/** Día del restaurante como YYYY-MM-DD, el formato de orders.local_date. */
export function localDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: POS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function formatElapsed(fromIso: string, nowMs = Date.now()): string {
  const elapsed = Math.max(0, nowMs - Date.parse(fromIso))
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Ahora'
  if (minutes === 1) return 'Hace 1 min'
  if (minutes < 60) return `Hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) return hours === 1 ? 'Hace 1 h' : `Hace ${hours} h`
  return hours === 1 ? `Hace 1 h ${rest} min` : `Hace ${hours} h ${rest} min`
}

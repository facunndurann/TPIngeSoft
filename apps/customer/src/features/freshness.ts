/**
 * Antigüedad de los datos que se refrescan solos (carta, pedidos, cuenta) en
 * palabras del comensal. Es solo formato: el momento de cada lectura lo tiene
 * react-query en `dataUpdatedAt`.
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** Cada cuánto reescribir un "hace X" en pantalla para que no quede viejo. */
export const AGE_TICK_MS = 15_000

export function relativeAge(updatedAt: number, now: number) {
  // Un reloj que se atrasa no puede producir un "hace -3 min".
  const elapsed = Math.max(0, now - updatedAt)
  if (elapsed < MINUTE_MS) return 'hace instantes'
  if (elapsed < HOUR_MS) return `hace ${Math.floor(elapsed / MINUTE_MS)} min`
  return `hace ${Math.floor(elapsed / HOUR_MS)} h`
}

/**
 * Antigüedad de un panel que muestra varias consultas juntas: manda la lectura
 * más vieja. `0` es "todavía no hubo lectura" en react-query, así que no cuenta;
 * sin ninguna lectura no hay antigüedad que mostrar.
 */
export function oldestUpdate(...updatedAt: number[]) {
  const known = updatedAt.filter((value) => value > 0)
  return known.length ? Math.min(...known) : undefined
}

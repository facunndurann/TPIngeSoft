/**
 * Antigüedad de los datos que se refrescan solos (carta, pedidos, cuenta). El
 * momento de cada lectura lo tiene react-query en `dataUpdatedAt`; ponerlo en
 * palabras es de `formatElapsed`, que es el mismo para las dos apps.
 */

/**
 * Antigüedad de un panel que muestra varias consultas juntas: manda la lectura
 * más vieja. `0` es "todavía no hubo lectura" en react-query, así que no cuenta;
 * sin ninguna lectura no hay antigüedad que mostrar.
 */
export function oldestUpdate(...updatedAt: number[]) {
  const known = updatedAt.filter((value) => value > 0)
  return known.length ? Math.min(...known) : undefined
}

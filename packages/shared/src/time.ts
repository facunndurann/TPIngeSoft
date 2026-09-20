/**
 * Tiempo: la zona en la que opera el local y las dos formas en que las apps lo
 * muestran. El día lo decide la zona del restaurante y no la del navegador: un
 * pedido de las 23:30 en Buenos Aires pertenece a ese día aunque el tablero se
 * abra desde otro huso.
 */
export const RESTAURANT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/** El día local como 'YYYY-MM-DD', que es la clave con la que se agrupa el historial. */
export function localDateKey(now: Date = new Date(), timeZone = RESTAURANT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** La hora conserva los minutos solo donde importa cuánto se lleva esperando. */
export type ElapsedPrecision = 'coarse' | 'exact';

/**
 * Cuánto hace que pasó algo, en minúscula y sin sujeto, para que entre en
 * cualquier frase: «Actualizado hace 5 min», «Pediste la cuenta · hace 1 h».
 * Antes había dos de estos, uno por app, y el que escribía con mayúscula se
 * corregía con un `.toLowerCase()` en el call site.
 *
 * `from` es el ISO de la base o los milisegundos de react-query, y `now` es
 * obligatorio: el texto envejece con el reloj de la app y no con el suyo.
 * Con `exact` la hora conserva los minutos («hace 1 h 5 min»), que es lo que
 * el salón necesita para saber cuánto hace que una mesa espera.
 */
export function formatElapsed(
  from: string | number,
  now: number,
  precision: ElapsedPrecision = 'coarse',
): string {
  const since = typeof from === 'number' ? from : Date.parse(from);
  // Un reloj que se atrasa no puede producir un «hace -3 min».
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) return 'hace instantes';
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return precision === 'exact' && rest > 0 ? `hace ${hours} h ${rest} min` : `hace ${hours} h`;
}

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

/** Cuánto hace que pasó algo, en palabras: 'Ahora', 'Hace 20 min', 'Hace 1 h 5 min'. */
export function formatElapsed(fromIso: string, nowMs = Date.now()): string {
  const elapsed = Math.max(0, nowMs - Date.parse(fromIso));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Ahora';
  if (minutes === 1) return 'Hace 1 min';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return hours === 1 ? 'Hace 1 h' : `Hace ${hours} h`;
  return hours === 1 ? `Hace 1 h ${rest} min` : `Hace ${hours} h ${rest} min`;
}

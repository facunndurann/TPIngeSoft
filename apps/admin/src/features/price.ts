/**
 * Precio tipeado en un input, o `null` si el texto todavía no es uno: vacío,
 * negativo o no numérico. Los borradores guardan el texto tal cual y recién acá
 * se decide si es un precio, así un campo vacío nunca se lee como 0.
 */
export function parsePrice(text: string): number | null {
  const price = Number(text)
  return text.trim() !== '' && Number.isFinite(price) && price >= 0 ? price : null
}

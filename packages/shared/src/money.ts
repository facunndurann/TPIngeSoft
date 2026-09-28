/**
 * Plata: leerla, calcularla y mostrarla. Un importe llega de la base como
 * `numeric` (o sea, string), se suma y se compara en centavos enteros para no
 * arrastrar errores de punto flotante, y se muestra en pesos. Lo comparten el
 * comensal, el admin, el POS y las edge functions: nadie multiplica por 100 a mano.
 */

/** Un importe de la base, que puede venir como número, como string o sin venir. */
export function asAmount(value: number | string | null | undefined): number {
  const amount = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

/** Un importe en centavos enteros: la unidad en la que se suma y se compara la plata. */
export function toCents(value: number | string | null | undefined): number {
  return Math.round(asAmount(value) * 100);
}

/** De centavos a pesos: para mostrar o guardar lo que se calculó en centavos. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** La suma de varios importes, en centavos. */
export function sumCents(values: readonly (number | string | null | undefined)[]): number {
  return values.reduce<number>((total, value) => total + toCents(value), 0);
}

/**
 * Si un número tiene como máximo dos decimales, que es lo que guarda la base.
 * Se compara con su versión redondeada y no multiplicando por 100: 1.1 × 100 da
 * 110.00000000000001 y tiene que pasar, mientras que el ruido de un cálculo en
 * float (0.1 + 0.2) viaja en el JSON con todos sus decimales y no debe pasar.
 */
export function hasAtMostTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Number(value.toFixed(2)) === value;
}

/**
 * Un importe tipeado en un input, o `null` si el texto todavía no es uno: vacío,
 * negativo, no numérico o con más de dos decimales. Los borradores guardan el
 * texto tal cual y recién acá se decide si es un importe, así un campo vacío
 * nunca se lee como 0 y un «1.234» no se redondea en silencio al guardarlo.
 */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const amount = Number(trimmed);
  return amount >= 0 && hasAtMostTwoDecimals(amount) ? amount : null;
}

/**
 * Precios en pesos, con centavos solo cuando existen. Una sola instancia de
 * Intl: se llama por ítem, por modificador y por línea de pedido.
 */
const priceFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatPrice(value: number | string | null | undefined): string {
  return priceFormatter.format(asAmount(value));
}

export interface SelectedModifier {
  optionId: string;
  priceDelta: number;
}

/** El precio de una línea en centavos: base más modificadores, por la cantidad. */
export function itemPriceCents(
  basePrice: number,
  modifiers: SelectedModifier[],
  quantity: number,
): number {
  return (toCents(basePrice) + sumCents(modifiers.map((modifier) => modifier.priceDelta))) * quantity;
}

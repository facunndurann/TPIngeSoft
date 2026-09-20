/**
 * Plata: leerla, calcularla y mostrarla. Un importe llega de la base como
 * `numeric` (o sea, string), se suma en centavos para no arrastrar errores de
 * punto flotante y se muestra en pesos. Lo comparten el comensal, el admin, el
 * POS y las edge functions.
 */

/** Un importe de la base, que puede venir como número, como string o sin venir. */
export function asAmount(value: number | string | null | undefined): number {
  const amount = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
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

export function calculateItemPrice(
  basePrice: number,
  modifiers: SelectedModifier[],
  quantity: number,
): number {
  const unitCents = modifiers.reduce(
    (total, m) => total + Math.round(m.priceDelta * 100),
    Math.round(basePrice * 100),
  );
  return (unitCents * quantity) / 100;
}

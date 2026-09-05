/**
 * Lógica de precios compartida entre la app del comensal, el admin y las
 * edge functions: precio base del producto + deltas de modificadores.
 * Los importes se suman en centavos para evitar errores de punto flotante.
 */

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

/**
 * Lógica de precios compartida entre la app del comensal, el admin y las
 * edge functions: precio base del producto + deltas de modificadores.
 * Se completa en la Fase 1/3 cuando exista el modelo de datos real.
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
  const unitPrice = modifiers.reduce((total, m) => total + m.priceDelta, basePrice);
  return unitPrice * quantity;
}

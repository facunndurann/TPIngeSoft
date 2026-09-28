import { formatPrice } from '@restaurant-platform/shared'
import { participantName, type PosOrder, type PosOrderItem } from './queries'

/**
 * Un ítem del pedido como lo leen cocina y caja: cantidad y producto, de quién
 * es, lo que se agregó y lo que se sacó. `withPrices` suma lo que cobra cada
 * agregado, que le importa a caja y no a cocina.
 */
export function OrderItemLine({
  order,
  item,
  withPrices = false,
}: {
  order: PosOrder
  item: PosOrderItem
  withPrices?: boolean
}) {
  return (
    <div>
      <p className="text-sm font-medium text-neutral-900">
        {item.quantity} × {item.product_name}
      </p>
      <p className="text-xs text-neutral-500">
        {item.is_shared ? 'Para compartir' : participantName(order, item.participant_id)}
      </p>
      {item.order_item_modifiers.map((modifier) => (
        <p key={modifier.id} className="text-xs text-neutral-600">
          + {modifier.group_name}: {modifier.option_name}
          {withPrices && ` (${formatPrice(modifier.price_delta)})`}
        </p>
      ))}
      {item.order_item_removed_ingredients.map((ingredient) => (
        <p key={ingredient.id} className="text-xs text-neutral-600">
          Sin {ingredient.ingredient_name}
        </p>
      ))}
    </div>
  )
}

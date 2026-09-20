import type { Announce } from './announcements'
import { plateCount } from './cart'
import { selectionErrors } from './menu'
import type { Menu, Product } from './menu'
import { useCart } from '../stores/cart'
import type { CartItem } from '../stores/cart'

/** Lo que un pedido guarda de cada plato: ids para repetirlo, nombre para nombrarlo. */
export type OrderedLine = {
  product_id: string | null
  product_name: string
  quantity: number
  is_shared: boolean
  order_item_modifiers: readonly { option_id: string | null }[]
  order_item_removed_ingredients: readonly { ingredient_id: string | null }[]
}

export type Reorder = {
  /** Borradores listos para el carrito, con ids nuevos. */
  items: CartItem[]
  /** Platos que hoy no se pueden repetir igual, por nombre. */
  skipped: string[]
}

/**
 * Rearma un pedido anterior como borrador del carrito, contra la carta de ahora.
 * Un pedido conserva el nombre y el precio del momento, así que repetirlo a
 * ciegas serviría un plato distinto: lo que el comensal eligió y hoy no está
 * disponible sale de la lista con su nombre, para que decida a mano.
 */
export function reorderLines(lines: readonly OrderedLine[], menu: Menu): Reorder {
  const items: CartItem[] = []
  const skipped: string[] = []

  for (const line of lines) {
    const product = line.product_id ? menu.productsById.get(line.product_id) : undefined
    const item = product && rebuild(line, product)
    if (item) items.push(item)
    else skipped.push(line.product_name)
  }

  return { items, skipped }
}

function rebuild(line: OrderedLine, product: Product): CartItem | undefined {
  // Solo se repiten las opciones que siguen existiendo, disponibles y en un grupo
  // disponible: si falta una que el comensal eligió, el plato ya no es el mismo.
  const available = new Set(
    product.groups
      .filter((group) => group.is_available)
      .flatMap((group) => group.options)
      .filter((option) => option.is_available)
      .map((option) => option.id),
  )
  const optionIds = line.order_item_modifiers.map((modifier) => modifier.option_id)
  if (optionIds.some((id) => !id || !available.has(id))) return undefined

  const removable = new Set(
    product.ingredients.filter((ingredient) => ingredient.is_removable).map(({ id }) => id),
  )
  const removedIds = line.order_item_removed_ingredients.map((entry) => entry.ingredient_id)
  if (removedIds.some((id) => !id || !removable.has(id))) return undefined

  const item: CartItem = {
    id: crypto.randomUUID(),
    productId: product.id,
    quantity: line.quantity,
    optionIds: optionIds as string[],
    // Un ingrediente agotado que se puede quitar se quita igual, como haría el
    // editor al agregar el plato hoy: no es una elección, es la única forma de pedirlo.
    removedIds: [
      ...new Set([
        ...(removedIds as string[]),
        ...product.ingredients
          .filter((ingredient) => !ingredient.is_available && ingredient.is_removable)
          .map(({ id }) => id),
      ]),
    ],
    isShared: line.is_shared,
  }

  // Una sola puerta: las mismas reglas que valida el carrito antes de enviar.
  return selectionErrors(product, item).length === 0 ? item : undefined
}

/**
 * El aviso de una ronda repetida, en una sola línea: cuánto entró al carrito y,
 * si algo quedó afuera, con qué nombre buscarlo en la carta.
 */
export function reorderAnnouncement({ items, skipped }: Reorder): string {
  const missing = skipped.length ? ` No pudimos repetir: ${skipped.join(', ')}.` : ''
  return items.length === 0
    ? `Este pedido ya no se puede repetir igual.${missing}`
    : `Agregamos ${plateCount(items.length)} a tu carrito.${missing}`
}

type ReorderOptions = {
  cartKey: string
  /** La carta de ahora; sin ella no hay contra qué revalidar el pedido. */
  menu?: Menu
  /** El carrito admite cambios: mesa abierta y sin envíos pendientes. */
  canEdit: boolean
  announce: Announce
}

/**
 * Repetir una ronda: rearma el pedido contra la carta de ahora, lo guarda en el
 * carrito y lo cuenta en un solo aviso, con lo que quedó afuera y con deshacer.
 * Devuelve `undefined` cuando repetir no es posible, así quien lo ofrece no
 * necesita saber por qué: el botón no aparece en un estado que fallaría.
 */
export function useReorder({ cartKey, menu, canEdit, announce }: ReorderOptions) {
  const cart = useCart()
  if (!canEdit || !menu) return undefined

  return (order: { order_items: readonly OrderedLine[] }) => {
    const { items, skipped } = reorderLines(order.order_items, menu)
    items.forEach((item) => cart.save(cartKey, item))
    // Sin nada repetido no hay nada que deshacer.
    const undo = items.length
      ? () => items.forEach((item) => cart.remove(cartKey, item.id))
      : undefined
    announce(reorderAnnouncement({ items, skipped }), undo)
  }
}

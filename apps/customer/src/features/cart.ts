import type { SubmitOrderInput } from '@restaurant-platform/shared'
import { selectionErrors } from './menu'
import type { Menu, Selection } from './menu'

/** Una línea del carrito: la selección de un plato, con id propio para editarla o quitarla. */
export type CartItem = Selection & { id: string; productId: string }

/** Un envío guardado sin resultado: lo que se mandó, tal cual, y las líneas que lo formaban. */
export type PendingSubmission = { input: SubmitOrderInput; snapshot: CartItem[] }

/** Líneas distintas por pedido; es el mismo máximo que valida submitOrderSchema. */
export const MAX_CART_LINES = 50

/** "3 platos" / "1 plato": el plural aparece en los avisos del carrito. */
export function plateCount(count: number) {
  return `${count} ${count === 1 ? 'plato' : 'platos'}`
}

/**
 * Clave persistida del carrito: uno por comensal dentro de cada sesión de mesa.
 * Es el único lugar que conoce el formato; cambiarlo deja huérfanos los envíos guardados.
 */
export function cartKeyFor(sessionId = '', userId = '') {
  return `${sessionId}:${userId}`
}

/** Compara por valor: no depende del orden de las claves ni del orden de las opciones elegidas. */
export function sameCartItem(a: CartItem, b: CartItem) {
  return (
    a.id === b.id &&
    a.productId === b.productId &&
    a.quantity === b.quantity &&
    a.isShared === b.isShared &&
    sameIds(a.optionIds, b.optionIds) &&
    sameIds(a.removedIds, b.removedIds)
  )
}

export function sameCartItems(a: CartItem[], b: CartItem[]) {
  return a.length === b.length && a.every((item, index) => sameCartItem(item, b[index]))
}

function sameIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const sorted = [...b].sort()
  return [...a].sort().every((id, index) => id === sorted[index])
}

/** Lo que el comensal vio al entrar a revisar: si cambia, tiene que volver a revisarlo. */
export type Review = { items: CartItem[]; total: number }

export type CartPhase =
  /** Hay un envío guardado sin resultado: el carrito queda bloqueado hasta reintentar o cancelar. */
  | { kind: 'pending'; submission: PendingSubmission; activity: 'idle' | 'sending' | 'cancelling' }
  | { kind: 'empty' }
  | { kind: 'editing'; editable: boolean; canReview: boolean }
  /** `confirmable` existe solo si se puede enviar, y trae exactamente lo que se enviaría. */
  | {
      kind: 'reviewing'
      review?: Review
      outdated: boolean
      confirmable?: { sessionId: string; expectedTotal: number }
    }

type CartPhaseInput = {
  items: CartItem[]
  menu?: Menu
  total: number
  sessionId?: string
  sessionOpen: boolean
  /** Si el comensal eligió su nombre: sin eso, la cuenta no se puede repartir. */
  named: boolean
  reviewing: boolean
  review?: Review
  submission?: PendingSubmission
  menuOutdated: boolean
  sending: boolean
  cancelling: boolean
}

/** Único lugar que decide qué puede hacer el comensal con su carrito. */
export function cartPhase(input: CartPhaseInput): CartPhase {
  const { items, review, sessionId, submission } = input

  if (submission) {
    const activity = input.sending ? 'sending' : input.cancelling ? 'cancelling' : 'idle'
    return { kind: 'pending', submission, activity }
  }
  if (!items.length) return { kind: 'empty' }

  // Un envío en curso sin envío guardado es un rechazo definitivo que todavía está
  // refrescando la carta: el borrador espera a que termine.
  const editable = input.sessionOpen && !input.sending
  // El nombre se exige para enviar, no para armar el carrito: se puede elegir
  // platos mientras se piensa, pero el pedido llega a la mesa con un dueño.
  const sendable =
    editable && input.named && !input.menuOutdated && validDraft(input.menu, items)
  if (!input.reviewing) return { kind: 'editing', editable, canReview: sendable }

  const outdated =
    !!review && (review.total !== input.total || !sameCartItems(review.items, items))
  const confirmable =
    sendable && sessionId && review && !outdated
      ? { sessionId, expectedTotal: review.total }
      : undefined
  return { kind: 'reviewing', review, outdated, confirmable }
}

function validDraft(menu: Menu | undefined, items: CartItem[]) {
  return (
    !!menu &&
    items.length <= MAX_CART_LINES &&
    items.every((item) => {
      const product = menu.productsById.get(item.productId)
      return !!product && selectionErrors(product, item).length === 0
    })
  )
}

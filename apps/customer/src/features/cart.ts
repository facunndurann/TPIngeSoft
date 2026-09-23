import { MAX_ORDER_LINES, type SubmitOrderInput } from '@restaurant-platform/shared'
import { selectionErrors } from './menu'
import type { Menu, Selection } from './menu'

/** Una línea del carrito: la selección de un plato, con id propio para editarla o quitarla. */
export type CartItem = Selection & { id: string; productId: string }

/** Un envío guardado sin resultado: lo que se mandó, tal cual, y las líneas que lo formaban. */
export type PendingSubmission = { input: SubmitOrderInput; snapshot: CartItem[] }

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

function sameIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const sorted = [...b].sort()
  return [...a].sort().every((id, index) => id === sorted[index])
}

/**
 * Por qué el comensal no puede sumar ni cambiar platos ahora, o `undefined` si puede.
 * Es la razón que muestra el botón apagado del plato, y su ausencia es el permiso
 * que leen la carta, el plato y «Pedir de nuevo»: el booleano y el motivo no pueden discrepar.
 */
export function cartLock({
  sessionOpen,
  closed,
  pending,
}: {
  sessionOpen: boolean
  closed: boolean
  /** Hay un envío guardado sin resultado: el carrito queda congelado hasta resolverlo. */
  pending: boolean
}): string | undefined {
  if (pending) return 'Tu último envío todavía necesita confirmación. Resolvelo en el carrito para sumar o cambiar platos.'
  if (closed) return 'La mesa ya cerró su cuenta: no se pueden sumar ni cambiar platos.'
  if (!sessionOpen) return 'Para sumar o cambiar platos hace falta estar conectado con la mesa.'
  return undefined
}

export type CartPhase =
  /** Hay un envío guardado sin resultado: el carrito queda bloqueado hasta reintentar o cancelar. */
  | { kind: 'pending'; submission: PendingSubmission; activity: 'idle' | 'sending' | 'cancelling' }
  | { kind: 'empty' }
  /** `sendable` existe solo si se puede enviar, y trae exactamente lo que se enviaría. */
  | { kind: 'editing'; editable: boolean; sendable?: { sessionId: string; expectedTotal: number } }

type CartPhaseInput = {
  items: CartItem[]
  menu?: Menu
  /** Total del carrito con la carta de ahora: el que muestra el botón y el que se firma. */
  total: number
  sessionId?: string
  sessionOpen: boolean
  /** Si el comensal eligió su nombre: sin eso, la cuenta no se puede repartir. */
  named: boolean
  submission?: PendingSubmission
  menuOutdated: boolean
  sending: boolean
  cancelling: boolean
}

/** Único lugar que decide qué puede hacer el comensal con su carrito. */
export function cartPhase(input: CartPhaseInput): CartPhase {
  const { items, sessionId, submission } = input

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
  const canSend =
    editable && input.named && !input.menuOutdated && validDraft(input.menu, items)
  // Se firma el total que el comensal ve en el botón. Si el servidor ya no llega al
  // mismo, rechaza el envío y el carrito pide actualizar la carta antes de reintentar.
  const sendable = canSend && sessionId ? { sessionId, expectedTotal: input.total } : undefined
  return { kind: 'editing', editable, sendable }
}

function validDraft(menu: Menu | undefined, items: CartItem[]) {
  return (
    !!menu &&
    items.length <= MAX_ORDER_LINES &&
    items.every((item) => {
      const product = menu.productsById.get(item.productId)
      return !!product && selectionErrors(product, item).length === 0
    })
  )
}

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { type CartItem, type PendingSubmission, sameCartItem } from '../features/cart'

type CartState = {
  carts: Record<string, CartItem[]>
  submissions: Record<string, PendingSubmission | undefined>
  /** Guarda una o varias líneas en una sola escritura: cada una reemplaza a la suya, o va al final. */
  save: (key: string, ...items: CartItem[]) => void
  /** Quita una o varias líneas en una sola escritura. */
  remove: (key: string, ...ids: string[]) => void
  restore: (key: string, item: CartItem, index: number) => void
  restoreAll: (key: string, items: CartItem[]) => void
  clear: (key: string) => void
  beginSubmission: (key: string, sessionId: string, expectedTotal: number) => PendingSubmission | undefined
  finishSubmission: (key: string, requestId: string) => void
  rejectSubmission: (key: string, requestId: string) => void
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => {
      /**
       * Única puerta para cambiar las líneas de un carrito: con un envío pendiente
       * el carrito está bloqueado y el cambio no se aplica. `edit` devuelve las
       * líneas nuevas, las mismas si no hay nada que cambiar, o `undefined` para
       * descartar el borrador entero.
       */
      const editCart = (key: string, edit: (items: CartItem[]) => CartItem[] | undefined) =>
        set((state) => {
          if (state.submissions[key]) return state
          const { [key]: items = [], ...others } = state.carts
          const next = edit(items)
          if (next === items) return state
          return { carts: next ? { ...others, [key]: next } : others }
        })

      return {
        carts: {},
        submissions: {},

        save: (key, ...lines) =>
          editCart(key, (items) => {
            if (lines.length === 0) return items
            const byId = new Map(lines.map((line) => [line.id, line]))
            const added = lines.filter((line) => !items.some((item) => item.id === line.id))
            return [...items.map((item) => byId.get(item.id) ?? item), ...added]
          }),

        remove: (key, ...ids) => editCart(key, (items) => items.filter((item) => !ids.includes(item.id))),

        restore: (key, item, index) =>
          editCart(key, (items) => {
            // Deshacer dos veces no puede duplicar el plato.
            if (items.some((entry) => entry.id === item.id)) return items
            // Vuelve a su posición original; si el carrito se acortó, al final.
            const at = Math.min(index, items.length)
            return [...items.slice(0, at), item, ...items.slice(at)]
          }),

        // Lo agregado después de vaciar se conserva y los recuperados vuelven
        // adelante, que es donde estaban. Deshacer dos veces no duplica nada.
        restoreAll: (key, restored) =>
          editCart(key, (items) => [
            ...restored,
            ...items.filter((item) => !restored.some((entry) => entry.id === item.id)),
          ]),

        clear: (key) => editCart(key, () => undefined),

        beginSubmission: (key, sessionId, expectedTotal) => {
          const existing = get().submissions[key]
          if (existing) return existing

          const snapshot = structuredClone(get().carts[key] ?? [])
          if (!snapshot.length) return undefined

          const submission = {
            input: {
              sessionId,
              requestId: crypto.randomUUID(),
              expectedTotal,
              items: snapshot.map(({ productId, quantity, optionIds, removedIds, isShared }) => ({
                productId,
                quantity,
                optionIds,
                removedIds,
                isShared,
              })),
            },
            snapshot,
          }
          set((state) => ({ submissions: { ...state.submissions, [key]: submission } }))
          return submission
        },

        finishSubmission: (key, requestId) =>
          set((state) => {
            const submission = state.submissions[key]
            if (submission?.input.requestId !== requestId) return state
            // Retain any draft that changed while the response was in flight.
            const remaining = (state.carts[key] ?? []).filter(
              (item) => !submission.snapshot.some((sent) => sameCartItem(sent, item)),
            )
            return {
              carts: { ...state.carts, [key]: remaining },
              submissions: { ...state.submissions, [key]: undefined },
            }
          }),

        rejectSubmission: (key, requestId) =>
          set((state) =>
            state.submissions[key]?.input.requestId === requestId
              ? { submissions: { ...state.submissions, [key]: undefined } }
              : state,
          ),
      }
    },
    { name: 'customer-carts', version: 1 },
  ),
)

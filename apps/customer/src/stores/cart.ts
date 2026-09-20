import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SubmitOrderInput } from '@restaurant-platform/shared'
import { sameCartItem } from '../features/cart'
import type { Selection } from '../features/menu'

export type CartItem = Selection & { id: string; productId: string }
export type PendingSubmission = { input: SubmitOrderInput; snapshot: CartItem[] }

type CartState = {
  carts: Record<string, CartItem[]>
  submissions: Record<string, PendingSubmission | undefined>
  save: (key: string, item: CartItem) => void
  remove: (key: string, id: string) => void
  restore: (key: string, item: CartItem, index: number) => void
  clear: (key: string) => void
  beginSubmission: (key: string, sessionId: string, expectedTotal: number) => PendingSubmission | undefined
  finishSubmission: (key: string, requestId: string) => void
  rejectSubmission: (key: string, requestId: string) => void
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      carts: {},
      submissions: {},

      save: (key, item) =>
        set((state) => {
          if (state.submissions[key]) return state
          const items = state.carts[key] ?? []
          const next = items.some((entry) => entry.id === item.id)
            ? items.map((entry) => (entry.id === item.id ? item : entry))
            : [...items, item]
          return { carts: { ...state.carts, [key]: next } }
        }),

      remove: (key, id) =>
        set((state) => {
          if (state.submissions[key]) return state
          return {
            carts: {
              ...state.carts,
              [key]: (state.carts[key] ?? []).filter((item) => item.id !== id),
            },
          }
        }),

      restore: (key, item, index) =>
        set((state) => {
          if (state.submissions[key]) return state
          const items = state.carts[key] ?? []
          // Deshacer dos veces no puede duplicar el plato.
          if (items.some((entry) => entry.id === item.id)) return state
          const next = [...items]
          // Vuelve a su posición original; si el carrito se acortó, al final.
          next.splice(Math.min(index, next.length), 0, item)
          return { carts: { ...state.carts, [key]: next } }
        }),

      clear: (key) =>
        set((state) => {
          if (state.submissions[key]) return state
          const carts = { ...state.carts }
          delete carts[key]
          return { carts }
        }),

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
    }),
    { name: 'customer-carts', version: 1 },
  ),
)

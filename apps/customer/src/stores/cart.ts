import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SubmitOrderInput } from '@restaurant-platform/shared'
import type { Selection } from '../features/menu'
export type CartItem = Selection & { id: string; productId: string }
export type PendingSubmission = { input: SubmitOrderInput; snapshot: CartItem[] }
type CartState = {
  carts: Record<string, CartItem[]>
  submissions: Record<string, PendingSubmission | undefined>
  save: (key: string, item: CartItem) => void
  remove: (key: string, id: string) => void
  beginSubmission: (key: string, sessionId: string, expectedTotal: number) => PendingSubmission | undefined
  finishSubmission: (key: string, requestId: string) => void
  rejectSubmission: (key: string, requestId: string) => void
}
export const useCart = create<CartState>()(persist((set, get) => ({
  carts: {},
  submissions: {},
  save: (key, item) => set(state => {
    if (state.submissions[key]) return state
    const items = state.carts[key] ?? []
    return { carts: { ...state.carts, [key]: items.some(i => i.id === item.id) ? items.map(i => i.id === item.id ? item : i) : [...items, item] } }
  }),
  remove: (key, id) => set(state => state.submissions[key] ? state : ({ carts: { ...state.carts, [key]: (state.carts[key] ?? []).filter(i => i.id !== id) } })),
  beginSubmission: (key, sessionId, expectedTotal) => {
    const existing = get().submissions[key]
    if (existing) return existing
    const snapshot = structuredClone(get().carts[key] ?? [])
    if (!snapshot.length) return undefined
    const submission = {
      input: {
        sessionId, requestId: crypto.randomUUID(), expectedTotal,
        items: snapshot.map(({ productId, quantity, optionIds, removedIds, isShared }) => ({ productId, quantity, optionIds, removedIds, isShared })),
      },
      snapshot,
    }
    set(state => ({ submissions: { ...state.submissions, [key]: submission } }))
    return submission
  },
  finishSubmission: (key, requestId) => set(state => {
    const submission = state.submissions[key]
    if (submission?.input.requestId !== requestId) return state
    // Retain any draft that changed while the response was in flight.
    const remaining = (state.carts[key] ?? []).filter(item => !submission.snapshot.some(sent => sent.id === item.id && JSON.stringify(sent) === JSON.stringify(item)))
    return { carts: { ...state.carts, [key]: remaining }, submissions: { ...state.submissions, [key]: undefined } }
  }),
  rejectSubmission: (key, requestId) => set(state => state.submissions[key]?.input.requestId === requestId ? { submissions: { ...state.submissions, [key]: undefined } } : state),
}), { name: 'customer-carts', version: 1 }))

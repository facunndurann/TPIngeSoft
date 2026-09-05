import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Selection } from '../features/menu'
export type CartItem = Selection & { id: string; productId: string }
type CartState = {
  carts: Record<string, CartItem[]>
  save: (key: string, item: CartItem) => void
  remove: (key: string, id: string) => void
}
export const useCart = create<CartState>()(persist((set) => ({
  carts: {},
  save: (key, item) => set(state => {
    const items = state.carts[key] ?? []
    return { carts: { ...state.carts, [key]: items.some(i => i.id === item.id) ? items.map(i => i.id === item.id ? item : i) : [...items, item] } }
  }),
  remove: (key, id) => set(state => ({ carts: { ...state.carts, [key]: (state.carts[key] ?? []).filter(i => i.id !== id) } })),
}), { name: 'customer-carts', version: 1 }))

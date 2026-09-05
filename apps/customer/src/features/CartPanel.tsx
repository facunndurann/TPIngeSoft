import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { cartPrice, money, price, selectionErrors } from './menu'
import type { Menu } from './menu'
import { SubmissionError, submitOrder } from './orders-api'
import { useCart } from '../stores/cart'
import type { CartItem } from '../stores/cart'

const definitiveRejections = new Set([
  'INVALID_REQUEST', 'INVALID_ITEMS', 'PAYLOAD_TOO_LARGE', 'SESSION_NOT_FOUND', 'SESSION_CLOSED', 'NOT_PARTICIPANT', 'TABLE_UNAVAILABLE',
  'PRODUCT_UNAVAILABLE', 'INVALID_MODIFIERS', 'INVALID_INGREDIENTS', 'PRICE_CHANGED',
])

type Props = {
  cartKey: string
  sessionId?: string
  menu?: Menu
  canEdit: boolean
  onEdit: (item: CartItem) => void
  refreshMenu: () => Promise<unknown>
  onSubmitted: () => void
}

export function CartPanel({ cartKey, sessionId, menu, canEdit, onEdit, refreshMenu, onSubmitted }: Props) {
  const cart = useCart()
  const items = cart.carts[cartKey] ?? []
  const pending = cart.submissions[cartKey]
  const [review, setReview] = useState<{ signature: string; total: number }>()
  const [needsMenuRefresh, setNeedsMenuRefresh] = useState(false)
  const signature = JSON.stringify(items)
  const total = menu ? cartPrice(menu, items) : 0
  const validItems = !!menu && items.length > 0 && items.length <= 50 && items.every(item => {
    const product = menu.products.find(p => p.id === item.productId)
    return product && selectionErrors(menu, product, item).length === 0
  })
  const refresh = async () => {
    setNeedsMenuRefresh(true)
    try { await refreshMenu(); setNeedsMenuRefresh(false) } catch { /* Leave confirmation disabled until current prices are available. */ }
  }
  const send = useMutation({
    mutationFn: submitOrder,
    retry: false,
    onSuccess: (_result, input) => {
      cart.finishSubmission(cartKey, input.requestId)
      setReview(undefined)
      onSubmitted()
    },
    onError: async (error, input) => {
      if (error instanceof SubmissionError && definitiveRejections.has(error.code)) {
        cart.rejectSubmission(cartKey, input.requestId)
        setReview(undefined)
        await refresh()
      }
    },
  })
  const editable = canEdit && !pending && !send.isPending
  const reviewed = review?.signature === signature && review.total === total
  const confirm = () => {
    if (!sessionId || !reviewed || !validItems || !canEdit || needsMenuRefresh || send.isPending) return
    const submission = cart.beginSubmission(cartKey, sessionId, review.total)
    if (submission) send.mutate(submission.input)
  }

  return <section aria-label="Tu carrito">
    <p className="eyebrow">ANTES DE PEDIR</p><h2>Tu carrito</h2>
    <p className="muted">Este carrito es tuyo. Los demás comensales arman el suyo en la misma sesión de mesa.</p>
    {items.length === 0 && <p className="empty">Tu carrito está vacío. Explorá la carta para agregar algo rico.</p>}
    {items.map(item => {
      const product = menu?.products.find(p => p.id === item.productId)
      const errors = menu ? product ? selectionErrors(menu, product, item) : ['El producto ya no está en la carta.'] : []
      return <article className="cart-item" key={item.id}>
        <h3>{product?.name ?? (menu ? 'Producto eliminado' : 'Producto del carrito')} {item.isShared && <span className="badge">Para compartir</span>}</h3>
        <p>Base: {product ? money(product.base_price) : '—'}</p>
        {item.optionIds.map(id => { const option = menu?.options.find(o => o.id === id); return <p key={id}>+ {option ? `${option.name} (${money(option.price_delta)})` : 'Opción pendiente de actualizar'}</p> })}
        {item.removedIds.map(id => <p key={id}>Sin {menu?.ingredients.find(i => i.id === id)?.name ?? 'ingrediente pendiente de actualizar'}</p>)}
        <div className="cart-actions"><label>Cantidad <input type="number" min="1" max="99" value={item.quantity} disabled={!editable || !!review} onChange={e => {
          const quantity = Number(e.target.value)
          if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 99) cart.save(cartKey, { ...item, quantity })
        }} /></label><strong>{product && menu ? money(price(menu, product, item)) : '—'}</strong></div>
        {errors.length > 0 && <p className="notice">{errors.join(' ')}</p>}
        <div className="cart-actions"><button disabled={!product || !editable || !!review} onClick={() => onEdit(item)}>Editar plato</button><button disabled={!editable || !!review} onClick={() => cart.remove(cartKey, item.id)}>Eliminar</button></div>
      </article>
    })}
    {send.isError && <p className="notice" role="alert">{send.error instanceof Error ? send.error.message : 'No pudimos enviar el pedido. Intentá nuevamente.'}</p>}
    {pending ? <div className="confirmation" aria-live="polite">
      <h3>{send.isPending ? 'Enviando tu pedido…' : 'Hay un envío por confirmar'}</h3>
      <p>{pending.snapshot.reduce((sum, item) => sum + item.quantity, 0)} productos · {money(pending.input.expectedTotal)}</p>
      <p>Conservamos este envío y bloqueamos su edición hasta conocer el resultado. Podés reintentarlo sin duplicar el pedido.</p>
      <button className="primary wide" disabled={send.isPending} onClick={() => send.mutate(pending.input)}>{send.isPending ? 'Confirmando envío…' : 'Reintentar el mismo envío'}</button>
    </div> : items.length > 0 && <>
      <div className="total"><span>Total estimado</span><strong>{menu ? money(total) : '—'}</strong></div>
      <p className="muted">Productos sin enviar. Al confirmar, el restaurante recibirá el pedido y validará precios y disponibilidad.</p>
      {items.length > 50 && <p className="notice">Podés enviar hasta 50 platos distintos por pedido.</p>}
      {!canEdit && <p className="notice">Para enviar necesitás una sesión de mesa abierta y conexión con la mesa.</p>}
      {needsMenuRefresh && <div className="notice"><p>Necesitamos actualizar la carta antes de que vuelvas a confirmar.</p><button onClick={() => { void refresh() }}>Actualizar carta</button></div>}
      {review ? <div className="confirmation" aria-label="Confirmación del pedido">
        <h3>Confirmá tu pedido</h3><p>Revisá los platos, las cantidades y los productos para compartir de arriba.</p>
        <p>Total revisado: <strong>{money(review.total)}</strong></p>
        {!reviewed && <p role="alert" className="notice">La carta o el carrito cambiaron. Volvé a revisar el pedido antes de enviarlo.</p>}
        <div className="cart-actions"><button onClick={() => setReview(undefined)}>Volver a editar</button><button className="primary" disabled={!reviewed || !validItems || !canEdit || needsMenuRefresh || send.isPending} onClick={confirm}>Confirmar y enviar</button></div>
      </div> : <button className="primary wide" disabled={!validItems || !canEdit || needsMenuRefresh || send.isPending} onClick={() => { send.reset(); setReview({ signature, total }) }}>Revisar pedido</button>}
    </>}
  </section>
}

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { cartPrice, money, price, selectionErrors } from '@/features/menu'
import type { Menu } from '@/features/menu'
import { SubmissionError, abandonSubmission, submitOrder } from '@/features/orders-api'
import { cartItemPath, cartPath, cartReviewPath } from '@/features/table-paths'
import { useCart } from '@/stores/cart'
import type { CartItem } from '@/stores/cart'

const definitiveRejections = new Set([
  'INVALID_REQUEST',
  'INVALID_ITEMS',
  'PAYLOAD_TOO_LARGE',
  'SESSION_NOT_FOUND',
  'SESSION_CLOSED',
  'NOT_PARTICIPANT',
  'TABLE_UNAVAILABLE',
  'PRODUCT_UNAVAILABLE',
  'INVALID_MODIFIERS',
  'INVALID_INGREDIENTS',
  'PRICE_CHANGED',
])

type CartPanelProps = {
  cartKey: string
  sessionId?: string
  menu?: Menu
  canEdit: boolean
  reviewing?: boolean
  refreshMenu: () => Promise<unknown>
  onSubmitted: () => void
}

export function CartPanel({
  cartKey,
  sessionId,
  menu,
  canEdit,
  reviewing = false,
  refreshMenu,
  onSubmitted,
}: CartPanelProps) {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const cart = useCart()
  const items = cart.carts[cartKey] ?? []
  const pending = cart.submissions[cartKey]
  const [review, setReview] = useState<{ signature: string; total: number }>()
  const [needsMenuRefresh, setNeedsMenuRefresh] = useState(false)
  const signature = JSON.stringify(items)
  const total = menu ? cartPrice(menu, items) : 0
  const validItems = !!menu && items.length > 0 && items.length <= 50 && items.every((item) => {
    const product = menu.products.find((entry) => entry.id === item.productId)
    return product && selectionErrors(menu, product, item).length === 0
  })

  useEffect(() => {
    if (!reviewing || !menu) return
    setReview((current) => current ?? { signature, total })
  }, [reviewing, menu, signature, total])

  const refresh = async () => {
    setNeedsMenuRefresh(true)
    try {
      await refreshMenu()
      setNeedsMenuRefresh(false)
    } catch {
      /* Leave confirmation disabled until current prices are available. */
    }
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
        if (reviewing) navigate(cartPath(token))
        await refresh()
      }
    },
  })

  const abandon = useMutation({
    mutationFn: abandonSubmission,
    retry: false,
    onMutate: () => send.reset(),
    onSuccess: (result, input) => {
      const submission = useCart.getState().submissions[cartKey]
      if (result.outcome === 'already_submitted' && submission?.input.requestId === input.requestId) {
        // El pedido ya llegó y no se puede editar. Reintentar es idempotente:
        // completa el despacho al POS si faltaba y cierra el envío por onSuccess.
        send.mutate(submission.input)
        return
      }
      cart.rejectSubmission(cartKey, input.requestId)
      setReview(undefined)
      navigate(cartPath(token))
    },
  })

  const editable = canEdit && !pending && !send.isPending
  const reviewed = review?.signature === signature && review.total === total

  const confirm = () => {
    if (!review || !sessionId || !reviewed || !validItems || !canEdit || needsMenuRefresh || send.isPending) {
      return
    }
    const submission = cart.beginSubmission(cartKey, sessionId, review.total)
    if (submission) send.mutate(submission.input)
  }

  return (
    <section aria-label="Tu carrito">
      <p className="eyebrow">ANTES DE PEDIR</p>
      <h2>Tu carrito</h2>
      <p className="muted">
        Este carrito es tuyo. Los demás comensales arman el suyo en la misma sesión de mesa.
      </p>

      {items.length === 0 && (
        <p className="empty">Tu carrito está vacío. Explorá la carta para agregar algo rico.</p>
      )}

      {items.map((item) => (
        <CartLine
          key={item.id}
          item={item}
          menu={menu}
          editable={editable}
          reviewing={reviewing}
          onQuantityChange={(quantity) => cart.save(cartKey, { ...item, quantity })}
          onEdit={() => navigate(cartItemPath(token, item.id))}
          onRemove={() => cart.remove(cartKey, item.id)}
        />
      ))}

      {send.isError && (
        <p className="notice" role="alert">
          {send.error instanceof Error
            ? send.error.message
            : 'No pudimos enviar el pedido. Intentá nuevamente.'}
        </p>
      )}
      {abandon.isError && (
        <p className="notice" role="alert">
          {abandon.error.message}
        </p>
      )}

      {pending ? (
        <PendingSubmission
          itemCount={pending.snapshot.reduce((sum, item) => sum + item.quantity, 0)}
          total={pending.input.expectedTotal}
          status={send.isPending ? 'sending' : abandon.isPending ? 'cancelling' : 'idle'}
          onRetry={() => {
            abandon.reset()
            send.mutate(pending.input)
          }}
          onCancel={() => abandon.mutate(pending.input)}
        />
      ) : (
        items.length > 0 && (
          <>
            <div className="total">
              <span>Total estimado</span>
              <strong>{menu ? money(total) : '—'}</strong>
            </div>
            <p className="muted">
              Productos sin enviar. Al confirmar, el restaurante recibirá el pedido y validará
              precios y disponibilidad.
            </p>
            {items.length > 50 && (
              <p className="notice">Podés enviar hasta 50 platos distintos por pedido.</p>
            )}
            {!canEdit && (
              <p className="notice">
                Para enviar necesitás una sesión de mesa abierta y conexión con la mesa.
              </p>
            )}
            {needsMenuRefresh && (
              <div className="notice">
                <p>Necesitamos actualizar la carta antes de que vuelvas a confirmar.</p>
                <button onClick={() => { void refresh() }}>Actualizar carta</button>
              </div>
            )}
            {reviewing ? (
              <div className="confirmation" aria-label="Confirmación del pedido">
                <h3>Confirmá tu pedido</h3>
                <p>Revisá los platos, las cantidades y los productos para compartir de arriba.</p>
                <p>
                  Total revisado: <strong>{money(review?.total ?? total)}</strong>
                </p>
                {review && !reviewed && (
                  <p role="alert" className="notice">
                    La carta o el carrito cambiaron. Volvé a revisar el pedido antes de enviarlo.
                  </p>
                )}
                <div className="cart-actions">
                  <button onClick={() => navigate(cartPath(token))}>Volver a editar</button>
                  <button
                    className="primary"
                    disabled={!reviewed || !validItems || !canEdit || needsMenuRefresh || send.isPending}
                    onClick={confirm}
                  >
                    Confirmar y enviar
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="primary wide"
                disabled={!validItems || !canEdit || needsMenuRefresh || send.isPending}
                onClick={() => {
                  send.reset()
                  navigate(cartReviewPath(token))
                }}
              >
                Revisar pedido
              </button>
            )}
          </>
        )
      )}
    </section>
  )
}

function CartLine({
  item,
  menu,
  editable,
  reviewing,
  onQuantityChange,
  onEdit,
  onRemove,
}: {
  item: CartItem
  menu?: Menu
  editable: boolean
  reviewing: boolean
  onQuantityChange: (quantity: number) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const product = menu?.products.find((entry) => entry.id === item.productId)
  const errors = menu
    ? product
      ? selectionErrors(menu, product, item)
      : ['El producto ya no está en la carta.']
    : []
  const title = product?.name ?? (menu ? 'Producto eliminado' : 'Producto del carrito')
  const locked = !editable || reviewing

  return (
    <article className="cart-item">
      <h3>
        {title} {item.isShared && <span className="badge">Para compartir</span>}
      </h3>
      <p>Base: {product ? money(product.base_price) : '—'}</p>
      {item.optionIds.map((id) => {
        const option = menu?.options.find((entry) => entry.id === id)
        return (
          <p key={id}>
            + {option ? `${option.name} (${money(option.price_delta)})` : 'Opción pendiente de actualizar'}
          </p>
        )
      })}
      {item.removedIds.map((id) => (
        <p key={id}>
          Sin {menu?.ingredients.find((ingredient) => ingredient.id === id)?.name ?? 'ingrediente pendiente de actualizar'}
        </p>
      ))}
      <div className="cart-actions">
        <label>
          Cantidad{' '}
          <input
            type="number"
            min="1"
            max="99"
            value={item.quantity}
            disabled={locked}
            onChange={(event) => {
              const quantity = Number(event.target.value)
              if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 99) {
                onQuantityChange(quantity)
              }
            }}
          />
        </label>
        <strong>{product && menu ? money(price(menu, product, item)) : '—'}</strong>
      </div>
      {errors.length > 0 && <p className="notice">{errors.join(' ')}</p>}
      <div className="cart-actions">
        <button disabled={!product || locked} onClick={onEdit}>
          Editar plato
        </button>
        <button disabled={locked} onClick={onRemove}>
          Eliminar
        </button>
      </div>
    </article>
  )
}

function PendingSubmission({
  itemCount,
  total,
  status,
  onRetry,
  onCancel,
}: {
  itemCount: number
  total: number
  status: 'idle' | 'sending' | 'cancelling'
  onRetry: () => void
  onCancel: () => void
}) {
  const busy = status !== 'idle'
  return (
    <div className="confirmation" aria-live="polite">
      <h3>{status === 'sending' ? 'Enviando tu pedido…' : 'Hay un envío por confirmar'}</h3>
      <p>
        {itemCount} productos · {money(total)}
      </p>
      <p>
        Conservamos este envío y bloqueamos su edición hasta conocer el resultado. Podés
        reintentarlo sin duplicar el pedido, o cancelarlo si todavía no llegó al restaurante.
      </p>
      <div className="cart-actions" style={{ marginTop: '16px' }}>
        <button onClick={onCancel} disabled={busy}>
          {status === 'cancelling' ? 'Cancelando…' : 'Cancelar y editar'}
        </button>
        <button className="primary" disabled={busy} onClick={onRetry}>
          {status === 'sending' ? 'Confirmando…' : 'Reintentar'}
        </button>
      </div>
    </div>
  )
}

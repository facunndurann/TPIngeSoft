import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AppError, formatPrice } from '@restaurant-platform/shared'
import { useNavigate, useParams } from 'react-router'
import { QuantityField } from '@/components/QuantityField'
import type { Announce } from '@/features/announcements'
import { MAX_CART_LINES, cartPhase } from '@/features/cart'
import type { Review } from '@/features/cart'
import { cartPrice, price, productOptions, selectionErrors } from '@/features/menu'
import type { Menu } from '@/features/menu'
import { abandonSubmission, submitOrder } from '@/features/orders-api'
import { focusNameField } from '@/features/name-field'
import { cartItemPath, cartPath, cartReviewPath } from '@/features/table-paths'
import { useCart } from '@/stores/cart'
import type { CartItem } from '@/stores/cart'

type CartPanelProps = {
  cartKey: string
  sessionId?: string
  menu?: Menu
  sessionOpen: boolean
  /** Si el comensal ya eligió su nombre; sin eso no se envía el pedido. */
  named: boolean
  reviewing?: boolean
  refreshMenu: () => Promise<unknown>
  onSubmitted: () => void
  /** Avisos al comensal; los muestra el Toast de la mesa. */
  onAnnounce: Announce
}

export function CartPanel({
  cartKey,
  sessionId,
  menu,
  sessionOpen,
  named,
  reviewing = false,
  refreshMenu,
  onSubmitted,
  onAnnounce,
}: CartPanelProps) {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const cart = useCart()
  const items = cart.carts[cartKey] ?? []
  const total = menu ? cartPrice(menu, items) : 0
  const [needsMenuRefresh, setNeedsMenuRefresh] = useState(false)

  // La revisión se fija una sola vez por montaje, apenas hay precios. El panel se
  // remonta al entrar o salir de revisar (key en TablePage), así que no hace falta limpiarla.
  const [review, setReview] = useState<Review>()
  if (reviewing && menu && !review) setReview({ items, total })

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
      onSubmitted()
    },
    onError: async (error, input) => {
      // Solo un rechazo definitivo libera el envío; si se puede reintentar, queda
      // pendiente para repetirlo con el mismo requestId sin duplicar el pedido.
      if (error instanceof AppError && !error.retryable) {
        cart.rejectSubmission(cartKey, input.requestId)
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
        // devuelve ese mismo pedido y cierra el envío por onSuccess.
        send.mutate(submission.input)
        return
      }
      cart.rejectSubmission(cartKey, input.requestId)
      navigate(cartPath(token))
    },
  })

  const phase = cartPhase({
    items,
    menu,
    total,
    sessionId,
    sessionOpen,
    named,
    reviewing,
    review,
    submission: cart.submissions[cartKey],
    menuOutdated: needsMenuRefresh,
    sending: send.isPending,
    cancelling: abandon.isPending,
  })

  const confirm = () => {
    if (phase.kind !== 'reviewing' || !phase.confirmable) return
    const { sessionId, expectedTotal } = phase.confirmable
    const submission = cart.beginSubmission(cartKey, sessionId, expectedTotal)
    if (submission) send.mutate(submission.input)
  }

  return (
    <section aria-label="Tu carrito">
      <p className="eyebrow">ANTES DE PEDIR</p>
      <h2>Tu carrito</h2>
      <p className="muted">
        Este carrito es tuyo. Cada comensal arma el suyo y todos los pedidos van a la cuenta de
        la mesa.
      </p>

      {phase.kind === 'empty' && (
        <p className="empty">Tu carrito está vacío. Explorá la carta para agregar algo rico.</p>
      )}

      {items.map((item, index) => (
        <CartLine
          key={item.id}
          item={item}
          menu={menu}
          locked={phase.kind !== 'editing' || !phase.editable}
          onQuantityChange={(quantity) => cart.save(cartKey, { ...item, quantity })}
          onEdit={() => navigate(cartItemPath(token, item.id))}
          onRemove={() => {
            cart.remove(cartKey, item.id)
            const name = menu?.productsById.get(item.productId)?.name
            // Deshacer lo devuelve a su posición: quitar de más no cuesta nada.
            onAnnounce(
              name ? `${name} se quitó de tu carrito` : 'El plato se quitó de tu carrito',
              () => cart.restore(cartKey, item, index),
            )
          }}
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

      {phase.kind === 'pending' && (
        <PendingSubmission
          itemCount={phase.submission.snapshot.reduce((sum, item) => sum + item.quantity, 0)}
          total={phase.submission.input.expectedTotal}
          status={phase.activity}
          onRetry={() => {
            abandon.reset()
            send.mutate(phase.submission.input)
          }}
          onCancel={() => abandon.mutate(phase.submission.input)}
        />
      )}

      {(phase.kind === 'editing' || phase.kind === 'reviewing') && (
        <>
          <div className="total">
            <span>Total estimado</span>
            <strong>{menu ? formatPrice(total) : '—'}</strong>
          </div>
          <p className="muted">
            Productos sin enviar. Al confirmar, el restaurante recibirá el pedido y validará
            precios y disponibilidad.
          </p>
          {items.length > MAX_CART_LINES && (
            <p className="notice">
              Podés enviar hasta {MAX_CART_LINES} platos distintos por pedido.
            </p>
          )}
          {!sessionOpen && (
            <p className="notice">
              Para enviar tu pedido, la mesa tiene que estar abierta y con conexión.
            </p>
          )}
          {sessionOpen && !named && (
            <div className="notice">
              <p>
                Poné tu nombre antes de enviar: es lo que permite saber qué pidió cada uno y
                repartir la cuenta.
              </p>
              <button onClick={focusNameField}>Poner mi nombre</button>
            </div>
          )}
          {needsMenuRefresh && (
            <div className="notice">
              <p>Necesitamos actualizar la carta antes de que vuelvas a confirmar.</p>
              <button onClick={() => { void refresh() }}>Actualizar carta</button>
            </div>
          )}
          {phase.kind === 'reviewing' ? (
            <div className="confirmation" aria-label="Confirmación del pedido">
              <h3>Confirmá tu pedido</h3>
              <p>Revisá los platos, las cantidades y los productos para compartir de arriba.</p>
              <p>
                Total revisado: <strong>{formatPrice(phase.review?.total ?? total)}</strong>
              </p>
              {phase.outdated && (
                <p role="alert" className="notice">
                  La carta o el carrito cambiaron. Volvé a revisar el pedido antes de enviarlo.
                </p>
              )}
              <div className="cart-actions">
                <button onClick={() => navigate(cartPath(token))}>Volver a editar</button>
                <button className="primary" disabled={!phase.confirmable} onClick={confirm}>
                  Confirmar y enviar
                </button>
              </div>
            </div>
          ) : (
            <button
              className="primary wide"
              disabled={!phase.canReview}
              onClick={() => {
                send.reset()
                navigate(cartReviewPath(token))
              }}
            >
              Revisar pedido
            </button>
          )}
        </>
      )}
    </section>
  )
}

function CartLine({
  item,
  menu,
  locked,
  onQuantityChange,
  onEdit,
  onRemove,
}: {
  item: CartItem
  menu?: Menu
  locked: boolean
  onQuantityChange: (quantity: number) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const product = menu?.productsById.get(item.productId)
  const options = product ? productOptions(product) : []
  const errors = menu
    ? product
      ? selectionErrors(product, item)
      : ['El producto ya no está en la carta.']
    : []
  const title = product?.name ?? (menu ? 'Producto eliminado' : 'Producto del carrito')

  return (
    <article className="cart-item">
      <h3>
        {title} {item.isShared && <span className="badge">Para compartir</span>}
      </h3>
      <p>Base: {product ? formatPrice(product.base_price) : '—'}</p>
      {item.optionIds.map((id) => {
        const option = options.find((entry) => entry.id === id)
        return (
          <p key={id}>
            + {option ? `${option.name} (${formatPrice(option.price_delta)})` : 'Opción pendiente de actualizar'}
          </p>
        )
      })}
      {item.removedIds.map((id) => (
        <p key={id}>
          Sin {product?.ingredients.find((ingredient) => ingredient.id === id)?.name ?? 'ingrediente pendiente de actualizar'}
        </p>
      ))}
      <div className="cart-actions">
        <span className="cart-quantity">
          Cantidad{' '}
          <QuantityField value={item.quantity} disabled={locked} onChange={onQuantityChange} />
        </span>
        <strong>{product ? formatPrice(price(product, item)) : '—'}</strong>
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
        {itemCount} productos · {formatPrice(total)}
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

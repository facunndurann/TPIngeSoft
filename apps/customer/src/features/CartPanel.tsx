import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AppError, formatPrice } from '@restaurant-platform/shared'
import { ErrorText } from '@restaurant-platform/ui'
import { useNavigate, useParams } from 'react-router'
import { QuantityField } from '@/components/QuantityField'
import { MAX_CART_LINES, cartPhase, plateCount } from '@/features/cart'
import type { CartItem, Review } from '@/features/cart'
import { cartPrice, price, productOptions, selectionErrors } from '@/features/menu'
import type { Menu } from '@/features/menu'
import { abandonSubmission, submitOrder } from '@/features/orders-api'
import { useTable } from '@/features/table-context'
import { cartItemPath, cartPath, cartReviewPath } from '@/features/table-paths'
import { useCart } from '@/stores/cart'

type CartPanelProps = {
  reviewing?: boolean
  refreshMenu: () => Promise<unknown>
  onSubmitted: () => void
}

/**
 * El carrito de la mesa. Los datos de la mesa —carrito, carta, si está abierta,
 * si el comensal ya tiene nombre— salen del contexto; por props llegan solo las
 * acciones que decide la pantalla que lo monta.
 */
export function CartPanel({ reviewing = false, refreshMenu, onSubmitted }: CartPanelProps) {
  const { cartKey, sessionId, menu: menuQuery, sessionOpen, named, announce } = useTable()
  const menu = menuQuery.data
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

      {phase.kind === 'editing' && items.map((item, index) => (
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
            announce(
              name ? `${name} se quitó de tu carrito` : 'El plato se quitó de tu carrito',
              () => cart.restore(cartKey, item, index),
            )
          }}
        />
      ))}

      {phase.kind === 'editing' && phase.editable && items.length > 1 && (
        <div className="cart-actions">
          <button
            className="text-button"
            onClick={() => {
              const discarded = items
              cart.clear(cartKey)
              // El reverso está en el aviso: vaciar de más no cuesta nada.
              announce(`Vaciamos tu carrito (${plateCount(discarded.length)})`, () =>
                cart.restoreAll(cartKey, discarded),
              )
            }}
          >
            Vaciar carrito
          </button>
        </div>
      )}

      {/* Sin `retry`: reintentar o cancelar el envío ya son botones del envío pendiente. */}
      <ErrorText
        variant="menu"
        error={send.error}
        fallback="No pudimos enviar el pedido. Intentá nuevamente."
      />
      <ErrorText variant="menu" error={abandon.error} />

      {phase.kind === 'pending' && (
        <PendingSubmission
          items={phase.submission.snapshot}
          menu={menu}
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
          {phase.kind === 'editing' && (
            <>
              <div className="total">
                <span>Total estimado</span>
                <strong>{menu ? formatPrice(total) : '—'}</strong>
              </div>
              <p className="muted">
                Productos sin enviar. Al confirmar, el restaurante recibirá el pedido y validará
                precios y disponibilidad.
              </p>
            </>
          )}
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
          {needsMenuRefresh && (
            <div className="notice">
              <p>Necesitamos actualizar la carta antes de que vuelvas a confirmar.</p>
              <button onClick={() => { void refresh() }}>Actualizar carta</button>
            </div>
          )}
          {phase.kind === 'reviewing' ? (
            <div className="confirmation" aria-label="Confirmación del pedido">
              <h3>Confirmá tu pedido</h3>
              <p>Esto es lo que va a recibir el restaurante:</p>
              {/* La revisión se fijó al entrar: es la que respalda el total que se confirma. */}
              <CartSummary items={phase.review?.items ?? items} menu={menu} />
              <div className="total">
                <span>Total</span>
                <strong>{formatPrice(phase.review?.total ?? total)}</strong>
              </div>
              {phase.outdated && (
                <p role="alert" className="notice">
                  La carta o el carrito cambiaron. Volvé a revisar el pedido antes de enviarlo.
                </p>
              )}
              <div className="cart-actions">
                <button onClick={() => navigate(cartPath(token))}>Volver a editar</button>
                <button className="primary" disabled={!phase.confirmable} onClick={confirm}>
                  Confirmar
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
      <div className="choice">
        <span>Cantidad</span>
        <QuantityField value={item.quantity} disabled={locked} onChange={onQuantityChange} />
      </div>
      <p className="cart-line-price">
        <strong>{product ? formatPrice(price(product, item)) : '—'}</strong>
      </p>
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

/**
 * Lo que se envía, en firme: el mismo contenido de las líneas del carrito pero sin
 * controles, para que confirmar no obligue a subir a mirar otra cosa.
 */
function CartSummary({
  items,
  menu,
  prices = true,
}: {
  items: CartItem[]
  menu?: Menu
  /** Un envío pendiente se firmó con su propio total: sus líneas no se revalúan con la carta de ahora. */
  prices?: boolean
}) {
  return (
    <ul className="cart-summary">
      {items.map((item) => {
        const product = menu?.productsById.get(item.productId)
        const options = product ? productOptions(product) : []
        // Personalizaciones en una línea: en la confirmación se leen, no se editan.
        const details = [
          ...item.optionIds.map(
            (id) => options.find((option) => option.id === id)?.name ?? 'opción por actualizar',
          ),
          ...item.removedIds.map(
            (id) =>
              `sin ${product?.ingredients.find((ingredient) => ingredient.id === id)?.name ?? 'ingrediente por actualizar'}`,
          ),
        ]

        return (
          <li key={item.id}>
            <div className="cart-summary-line">
              <span>
                {item.quantity} × {product?.name ?? 'Plato del carrito'}
                {item.isShared && <span className="badge">Para compartir</span>}
              </span>
              {prices && <strong>{product ? formatPrice(price(product, item)) : '—'}</strong>}
            </div>
            {details.length > 0 && <small>{details.join(' · ')}</small>}
          </li>
        )
      })}
    </ul>
  )
}

function PendingSubmission({
  items,
  menu,
  total,
  status,
  onRetry,
  onCancel,
}: {
  items: CartItem[]
  menu?: Menu
  total: number
  status: 'idle' | 'sending' | 'cancelling'
  onRetry: () => void
  onCancel: () => void
}) {
  const busy = status !== 'idle'
  return (
    <div className="confirmation" aria-live="polite">
      <h3>{status === 'sending' ? 'Enviando tu pedido…' : 'Hay un envío por confirmar'}</h3>
      <CartSummary items={items} menu={menu} prices={false} />
      <div className="total">
        <span>Total enviado</span>
        <strong>{formatPrice(total)}</strong>
      </div>
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

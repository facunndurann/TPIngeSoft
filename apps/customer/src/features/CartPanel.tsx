import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AppError, formatPrice, MAX_ORDER_LINES } from '@restaurant-platform/shared'
import { ErrorText } from '@restaurant-platform/ui'
import { useNavigate } from 'react-router'
import { QuantityField } from '@/components/QuantityField'
import { cartPhase, plateCount } from '@/features/cart'
import type { CartItem } from '@/features/cart'
import { describeSelection, price, selectionErrors } from '@/features/menu'
import type { Menu } from '@/features/menu'
import { abandonSubmission, submitOrder } from '@/features/orders-api'
import { useTable } from '@/features/table-context'
import { cartItemPath } from '@/features/table-paths'
import { useCart } from '@/stores/cart'

type CartPanelProps = {
  refreshMenu: () => Promise<unknown>
  onSubmitted: () => void
}

/**
 * El carrito de la mesa. Los datos de la mesa —carrito, carta, si está abierta,
 * si el comensal ya tiene nombre— salen del contexto; por props llegan solo las
 * acciones que decide la pantalla que lo monta.
 */
export function CartPanel({ refreshMenu, onSubmitted }: CartPanelProps) {
  const {
    token,
    cartKey,
    items,
    cartTotal: total,
    sessionId,
    menu: menuQuery,
    sessionOpen,
    named,
    announce,
  } = useTable()
  const menu = menuQuery.data
  const navigate = useNavigate()
  const cart = useCart()
  const [needsMenuRefresh, setNeedsMenuRefresh] = useState(false)

  const refresh = async () => {
    setNeedsMenuRefresh(true)
    try {
      await refreshMenu()
      setNeedsMenuRefresh(false)
    } catch {
      /* El envío sigue apagado hasta tener los precios de ahora. */
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
      // Cancelado, el borrador vuelve a ser editable en esta misma pantalla.
      cart.rejectSubmission(cartKey, input.requestId)
    },
  })

  const phase = cartPhase({
    items,
    menu,
    total,
    sessionId,
    sessionOpen,
    named,
    submission: cart.submissions[cartKey],
    menuOutdated: needsMenuRefresh,
    sending: send.isPending,
    cancelling: abandon.isPending,
  })

  // Firma el carrito tal como se ve y lo envía: el total esperado es el del botón.
  const submit = () => {
    if (phase.kind !== 'editing' || !phase.sendable) return
    const { sessionId, expectedTotal } = phase.sendable
    const submission = cart.beginSubmission(cartKey, sessionId, expectedTotal)
    if (submission) send.mutate(submission.input)
  }

  // Cada fase dibuja lo suyo en su bloque, y ningún bloque vuelve a preguntar la
  // fase: las líneas van arriba, los errores del envío al medio y el cierre abajo.
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

      {phase.kind === 'editing' && (
        <>
          {items.map((item, index) => (
            <CartLine
              key={item.id}
              item={item}
              menu={menu}
              locked={!phase.editable}
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
          {phase.editable && items.length > 1 && (
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
        </>
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

      {phase.kind === 'editing' && (
        <>
          <div className="total">
            <span>Total estimado</span>
            <strong>{menu ? formatPrice(total) : '—'}</strong>
          </div>
          <p className="muted">
            Productos sin enviar. Al enviarlos, el restaurante recibe el pedido y valida precios y
            disponibilidad.
          </p>
          <SendBlockers
            tooManyLines={items.length > MAX_ORDER_LINES}
            sessionOpen={sessionOpen}
            needsMenuRefresh={needsMenuRefresh}
            onRefreshMenu={() => { void refresh() }}
          />
          <button className="primary wide" disabled={!phase.sendable} onClick={submit}>
            {menu ? `Enviar pedido · ${formatPrice(total)}` : 'Enviar pedido'}
          </button>
        </>
      )}
    </section>
  )
}

/** Lo que impide enviar aunque el carrito esté bien armado. */
function SendBlockers({
  tooManyLines,
  sessionOpen,
  needsMenuRefresh,
  onRefreshMenu,
}: {
  tooManyLines: boolean
  sessionOpen: boolean
  needsMenuRefresh: boolean
  onRefreshMenu: () => void
}) {
  return (
    <>
      {tooManyLines && (
        <p className="notice">Podés enviar hasta {MAX_ORDER_LINES} platos distintos por pedido.</p>
      )}
      {!sessionOpen && (
        <p className="notice">
          Para enviar tu pedido, la mesa tiene que estar abierta y con conexión.
        </p>
      )}
      {needsMenuRefresh && (
        <div className="notice">
          <p>Necesitamos actualizar la carta antes de que vuelvas a enviar el pedido.</p>
          <button onClick={onRefreshMenu}>Actualizar carta</button>
        </div>
      )}
    </>
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
  const { options, removed } = describeSelection(product, item)
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
      {options.map((option) => (
        <p key={option.id}>
          + {option.name}
          {option.priceDelta !== undefined && ` (${formatPrice(option.priceDelta)})`}
        </p>
      ))}
      {removed.map((ingredient) => (
        <p key={ingredient.id}>Sin {ingredient.name}</p>
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
 * Lo que se mandó en un envío pendiente, en firme y sin controles. Va sin precios
 * por línea: el envío se firmó con su propio total, y sus líneas no se revalúan
 * con la carta de ahora.
 */
function CartSummary({ items, menu }: { items: CartItem[]; menu?: Menu }) {
  return (
    <ul className="cart-summary">
      {items.map((item) => {
        const product = menu?.productsById.get(item.productId)
        const { options, removed } = describeSelection(product, item)
        // Personalizaciones en una línea: acá se leen, no se editan.
        const details = [
          ...options.map((option) => option.name),
          ...removed.map((ingredient) => `sin ${ingredient.name}`),
        ]

        return (
          <li key={item.id}>
            <div>
              {item.quantity} × {product?.name ?? 'Plato del carrito'}
              {item.isShared && <span className="badge">Para compartir</span>}
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
      <CartSummary items={items} menu={menu} />
      <div className="total">
        <span>Total enviado</span>
        <strong>{formatPrice(total)}</strong>
      </div>
      <p>
        Conservamos este envío y bloqueamos su edición hasta conocer el resultado. Podés
        reintentarlo sin duplicar el pedido, o cancelarlo si todavía no llegó al restaurante.
      </p>
      <div className="cart-actions">
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
